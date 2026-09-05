import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'

// Permission matrix from the spec: Admin gets every report, Trainer gets
// just the Training Report, Team Leader gets just a team-scoped view
// (mapped to the already-real My Team page rather than a placeholder —
// see the note on that card below), Member gets nothing.
type Access = 'full' | 'trainer' | 'teamLeader' | 'none'

interface ReportCard {
  key: string
  title: string
  items: string[]
  status: 'soon' | { label: string; to: string; note?: string }
}

const REPORTS: ReportCard[] = [
  { key: 'weekly', title: 'Weekly Report', items: ['Member Activity', 'Training Progress', 'Events', 'Team Performance'], status: 'soon' },
  { key: 'monthly', title: 'Monthly Report', items: ['Office Growth', 'Member Growth', 'Learning Progress', 'Leadership Growth'], status: 'soon' },
  {
    key: 'training',
    title: 'Training Report',
    items: ['Learning Systems', 'Lessons', 'Assignments', 'Quizzes', 'Certificates'],
    status: { label: 'View now', to: '/reports/training', note: 'Covers Learning Systems & Lessons today — Assignments/Quizzes/Certificates breakdowns are still Coming Soon.' },
  },
  {
    key: 'leadership',
    title: 'Leadership Report',
    items: ['Team Leaders', 'Promotions', 'Team Performance'],
    status: { label: 'View now', to: '/team-performance', note: 'Covers Team Performance today — a Team Leaders/Promotions roster is still Coming Soon.' },
  },
  { key: 'income', title: 'Income Development Report', items: ['Freelancing Progress', 'Income Milestones'], status: 'soon' },
  { key: 'network-marketing', title: 'Network Marketing Report', items: ['Customers', 'Distributors', 'Presentations', 'Follow-ups'], status: 'soon' },
]

function ReportCardView({ report }: { report: ReportCard }) {
  return (
    <div className="card">
      <h2>{report.title}</h2>
      <div className="upcoming-list" style={{ margin: '10px 0 14px' }}>
        {report.items.map((i) => <span className="upcoming-pill" key={i}>{i}</span>)}
      </div>
      {report.status === 'soon' ? (
        <span className="badge soon-badge">Coming Soon</span>
      ) : (
        <>
          <Link to={report.status.to} className="btn-primary-link">{report.status.label} →</Link>
          {report.status.note && <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 8 }}>{report.status.note}</p>}
        </>
      )}
    </div>
  )
}

export default function QuickReports() {
  const { currentMembership } = useAuth()
  const role = currentMembership?.role

  const access: Access =
    role === 'admin' ? 'full' : role === 'trainer' ? 'trainer' : role === 'team_leader' ? 'teamLeader' : 'none'

  if (access === 'none') {
    return (
      <div className="page">
        <h1>Quick Reports</h1>
        <p>You don't have permission to view reports.</p>
      </div>
    )
  }

  if (access === 'teamLeader') {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Quick Reports</h1>
          <p>Reports for your role are scoped to your own team.</p>
        </div>
        <div className="card-grid">
          <div className="card">
            <h2>Team Report</h2>
            <p style={{ color: 'var(--text-dim)' }}>Progress and activity for the team you lead.</p>
            <Link to="/my-team" className="btn-primary-link" style={{ marginTop: 10, display: 'inline-block' }}>View My Team →</Link>
          </div>
        </div>
      </div>
    )
  }

  const visibleReports = access === 'trainer' ? REPORTS.filter((r) => r.key === 'training') : REPORTS

  return (
    <div className="page">
      <div className="page-head">
        <h1>Quick Reports</h1>
        <p>Fast access to your office's business reports. Detailed report logic is still being built — the two "View now" reports below are the current real views; everything else is a preview of what's coming.</p>
      </div>

      {access === 'trainer' && (
        <p style={{ color: 'var(--text-faint)', fontSize: 12.5, marginBottom: 16 }}>Other report types aren't available for your role.</p>
      )}

      <div className="card-grid">
        {visibleReports.map((r) => <ReportCardView report={r} key={r.key} />)}
      </div>

      {access === 'full' && (
        <>
          <h4 className="overview-heading" style={{ marginTop: 32 }}>EXPORT OPTIONS</h4>
          <div className="upcoming-list">
            {['PDF', 'Excel', 'CSV'].map((f) => (
              <span className="upcoming-pill" key={f}>{f}<span className="badge soon-badge">Soon</span></span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
