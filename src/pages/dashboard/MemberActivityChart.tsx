import { Link } from 'react-router-dom'
import type { ActivityDay, OfficeSnapshot } from './useOfficeSnapshot'
import { Skeleton } from './dashboardShared'

const CHART_H = 128

function Bar({ day, max }: { day: ActivityDay; max: number }) {
  const total = day.attempts + day.coursework + day.joins
  const seg = (n: number) => (n === 0 ? 0 : Math.max(2, (n / max) * CHART_H))
  const title = `${day.weekday} ${day.label} — ${day.attempts} quiz${day.attempts === 1 ? "" : "zes"}, ${day.coursework} coursework, ${day.joins} join${day.joins === 1 ? '' : 's'}`
  return (
    <div className="mac-col" title={title}>
      {day.joins > 0 && <span className="mac-seg c" style={{ height: seg(day.joins) }} />}
      {day.coursework > 0 && <span className="mac-seg b" style={{ height: seg(day.coursework) }} />}
      {day.attempts > 0 && <span className="mac-seg a" style={{ height: seg(day.attempts) }} />}
      {total === 0 && <span className="mac-seg" style={{ height: 2, background: 'var(--line)' }} />}
    </div>
  )
}

export default function MemberActivityChart({ data, loading }: { data: OfficeSnapshot | null; loading: boolean }) {
  return (
    <section className="dash-card col-7">
      <div className="dash-card-head">
        <h2>Member Activity <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· last 14 days</span></h2>
        <Link to="/reports" className="dash-see-all">Reports →</Link>
      </div>

      {loading || !data ? (
        <Skeleton w="100%" h={CHART_H + 40} />
      ) : (
        (() => {
          const totals = data.activity.reduce(
            (acc, d) => {
              acc.attempts += d.attempts
              acc.coursework += d.coursework
              acc.joins += d.joins
              return acc
            },
            { attempts: 0, coursework: 0, joins: 0 },
          )
          const grand = totals.attempts + totals.coursework + totals.joins
          const max = Math.max(1, ...data.activity.map((d) => d.attempts + d.coursework + d.joins))

          if (grand === 0) {
            return (
              <p className="md-muted" style={{ padding: '28px 0', textAlign: 'center' }}>
                No quiz, coursework or join activity in the last 14 days.
              </p>
            )
          }

          return (
            <>
              <div className="mac-bars" role="img" aria-label={`Daily office activity for the last 14 days: ${totals.attempts} quizzes completed, ${totals.coursework} coursework submissions, ${totals.joins} new members.`}>
                {data.activity.map((d) => <Bar key={d.key} day={d} max={max} />)}
              </div>
              <div className="mac-axis">
                <span>{data.activity[0].label}</span>
                <span>Today</span>
              </div>
              <div className="mac-legend">
                <span><i style={{ background: 'var(--tint-primary)' }} />Quizzes completed ({totals.attempts})</span>
                <span><i style={{ background: 'var(--tint-learn)' }} />Coursework ({totals.coursework})</span>
                <span><i style={{ background: 'var(--tint-people)' }} />New members ({totals.joins})</span>
              </div>
              <table className="mac-sr">
                <caption>Office activity by day, last 14 days</caption>
                <thead><tr><th>Day</th><th>Quizzes</th><th>Coursework</th><th>Joins</th></tr></thead>
                <tbody>
                  {data.activity.map((d) => (
                    <tr key={d.key}><td>{d.weekday} {d.label}</td><td>{d.attempts}</td><td>{d.coursework}</td><td>{d.joins}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        })()
      )}
    </section>
  )
}
