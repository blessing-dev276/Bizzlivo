import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import Billing from '../billing/Billing'
import ProfileSettings from './ProfileSettings'
import OfficeSettings from './OfficeSettings'
import NotificationSettings from './NotificationSettings'
import SecuritySettings from './SecuritySettings'
import FinanceSettings from './FinanceSettings'
import MembershipDanger from './MembershipDanger'

const ADMIN_ROLES = new Set(['admin'])

export type SettingsSection = 'profile' | 'notifications' | 'security' | 'office' | 'billing' | 'finance'

// Each settings section is its own page now, reached at /settings/<section>.
// This one component renders whichever section the route asks for; admin-only
// sections bounce non-admins back to Profile.
export default function Settings({ section }: { section: SettingsSection }) {
  const { currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false

  if ((section === 'office' || section === 'billing' || section === 'finance') && !isAdmin) {
    return <Navigate to="/settings/profile" replace />
  }

  return (
    <div className="page">
      {section === 'profile' && (
        <>
          <ProfileSettings />
          <MembershipDanger />
        </>
      )}
      {section === 'notifications' && <NotificationSettings />}
      {section === 'security' && <SecuritySettings />}
      {section === 'office' && <OfficeSettings />}
      {section === 'billing' && <Billing />}
      {section === 'finance' && <FinanceSettings />}
    </div>
  )
}
