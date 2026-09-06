import { useAuth } from '../../lib/AuthContext'
import BusinessPath from './BusinessPath'
import BusinessPathAdmin from './BusinessPathAdmin'

// Admin gets the full path builder. Trainer / team leader get it read-only
// (view the configured journey; team progress lives on their team pages).
// Everyone else works their own journey.
export default function BusinessPathHub() {
  const { currentMembership } = useAuth()
  const role = currentMembership?.role

  if (role === 'admin') return <BusinessPathAdmin />
  if (role === 'trainer' || role === 'team_leader') return <BusinessPathAdmin readOnly />
  return <BusinessPath />
}
