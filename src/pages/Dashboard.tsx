import { useAuth } from '../lib/AuthContext'
import AdminDashboard from './dashboard/AdminDashboard'
import MemberHome from './dashboard/MemberHome'

const STAFF_DASHBOARD_ROLES = new Set(['admin', 'trainer'])

// Role router. Admin/Trainer get the office command center; everyone else
// (member, team_leader) gets the personal work-and-growth dashboard.
export default function Dashboard() {
  const { currentMembership } = useAuth()

  if (!currentMembership) {
    return (
      <div className="page">
        <h1>No office found</h1>
        <p>You're not a member of any office yet.</p>
      </div>
    )
  }

  return STAFF_DASHBOARD_ROLES.has(currentMembership.role) ? <AdminDashboard /> : <MemberHome />
}
