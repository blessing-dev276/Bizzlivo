import { Link } from 'react-router-dom'
import type { OfficeSnapshot } from './useOfficeSnapshot'
import { Skeleton } from './dashboardShared'

export default function PeopleHealth({ data, loading }: { data: OfficeSnapshot | null; loading: boolean }) {
  return (
    <section className="dash-card col-4">
      <div className="dash-card-head">
        <h2>People &amp; Teams</h2>
        <Link to="/team" className="dash-see-all">Team →</Link>
      </div>

      {loading || !data ? (
        <Skeleton w="100%" h={120} />
      ) : (
        (() => {
          const inactive = Math.max(0, data.totalMembers - data.activeThisWeek)
          const rows: [string, number][] = [
            ['Active this week', data.activeThisWeek],
            ['Inactive this week', inactive],
            ['Team leaders', data.teamLeaders],
            ['Teams', data.teamsCount],
            ['New this month', data.newThisMonth],
            ['Total members', data.totalMembers],
          ]
          return (
            <div className="ph-grid">
              {rows.map(([label, value]) => (
                <div className="ph-item" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )
        })()
      )}
    </section>
  )
}
