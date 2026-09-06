import { useAuth } from '../../lib/AuthContext'
import RecentActivity from '../../components/RecentActivity'
import { DashboardSkeleton } from '../../components/AppSkeleton'
import { useOfficeSnapshot } from './useOfficeSnapshot'
import DashboardHeader from './DashboardHeader'
import OfficePulse from './OfficePulse'
import TodaysFocus from './TodaysFocus'
import QuickActions from './QuickActions'
import MemberActivityChart from './MemberActivityChart'
import TrainingProgress from './TrainingProgress'
import UpcomingEvents from './UpcomingEvents'
import PeopleHealth from './PeopleHealth'
import OfficeOverview from './OfficeOverview'
import OfficeInsights, { officeHasInsights } from './OfficeInsights'
import WorkplaceFooter from './WorkplaceFooter'

// The office command center — for admin and trainer roles.
export default function AdminDashboard() {
  const { profile, currentMembership } = useAuth()
  const org = currentMembership!.organization
  const orgId = org.id
  const role = currentMembership!.role
  const canManageBilling = role === 'admin'

  const { data, loading, error } = useOfficeSnapshot(orgId)
  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'
  const showInsights = officeHasInsights(data, role)

  if (loading && !data) return <DashboardSkeleton />

  return (
    <div className="page cmd-deck">
      <div className="dash">
        <DashboardHeader firstName={firstName} officeName={org.name} officeSlug={org.slug} orgId={orgId} />

        {error && !data && (
          <div className="dash-card" style={{ borderColor: 'var(--tint-attn)' }}>
            <p className="md-muted">Some office data couldn't load right now. Try refreshing — your quick actions below still work.</p>
          </div>
        )}

        <OfficePulse data={data} loading={loading} />

        <div className="dash-grid">
          <TodaysFocus data={data} loading={loading} />
          <QuickActions />

          <MemberActivityChart data={data} loading={loading} />
          <UpcomingEvents data={data} loading={loading} />

          <TrainingProgress data={data} loading={loading} />
          <PeopleHealth data={data} loading={loading} />
          <OfficeOverview orgId={orgId} />

          <div className={showInsights ? 'col-7' : 'col-12'}>
            <RecentActivity compact limit={7} />
          </div>
          {showInsights && <OfficeInsights data={data} role={role} />}
        </div>

        <WorkplaceFooter orgId={orgId} canManageBilling={canManageBilling} />
      </div>
    </div>
  )
}
