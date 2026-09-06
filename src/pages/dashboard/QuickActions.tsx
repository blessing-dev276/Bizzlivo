import { Link } from 'react-router-dom'
import { IcInvite, IcUpload, IcExam, IcClipboard, IcCalendar, IcReport } from './icons'

const ACTIONS = [
  { label: 'Invite Member', to: '/invites', icon: <IcInvite />, tint: 'var(--tint-people)', soft: 'var(--tint-people-soft)' },
  { label: 'Upload Training', to: '/quizzes', icon: <IcUpload />, tint: 'var(--tint-learn)', soft: 'var(--tint-learn-soft)' },
  { label: 'Create Quiz', to: '/quizzes', icon: <IcExam />, tint: 'var(--tint-primary)', soft: 'var(--tint-primary-soft)' },
  { label: 'New Assignment', to: '/assignments/new', icon: <IcClipboard />, tint: 'var(--tint-primary)', soft: 'var(--tint-primary-soft)' },
  { label: 'Create Event', to: '/events/new', icon: <IcCalendar />, tint: 'var(--tint-events)', soft: 'var(--tint-events-soft)' },
  { label: 'View Reports', to: '/reports', icon: <IcReport />, tint: 'var(--tint-ok)', soft: 'var(--tint-ok-soft)' },
]

export default function QuickActions() {
  return (
    <section className="dash-card col-5">
      <div className="dash-card-head">
        <h2>Quick Actions</h2>
      </div>
      <div className="qa-grid">
        {ACTIONS.map((a) => (
          <Link
            to={a.to}
            className="qa-tile"
            key={a.label}
            style={{ ['--_t' as string]: a.tint, ['--_ts' as string]: a.soft }}
          >
            <span className="qa-ico">{a.icon}</span>
            <span className="qa-name">{a.label}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
