import { Navigate, NavLink } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import Billing from '../billing/Billing'
import ProfileSettings from './ProfileSettings'
import OfficeSettings from './OfficeSettings'
import NotificationSettings from './NotificationSettings'
import SecuritySettings from './SecuritySettings'
import FinanceSettings from './FinanceSettings'
import IntegrationsSettings from './IntegrationsSettings'
import MembershipDanger from './MembershipDanger'

const ADMIN_ROLES = new Set(['admin'])

export type SettingsSection = 'profile' | 'notifications' | 'security' | 'office' | 'billing' | 'finance' | 'integrations'

// Office-scoped areas (admin only) share one page with a tab bar so the
// sidebar stays short. Personal areas (profile / notifications / security)
// are their own sidebar entries.
const OFFICE_TABS: { to: string; section: SettingsSection; label: string }[] = [
  { to: '/settings/office', section: 'office', label: 'General' },
  { to: '/settings/finance', section: 'finance', label: 'Finance' },
  { to: '/settings/integrations', section: 'integrations', label: 'Integrations' },
  { to: '/settings/billing', section: 'billing', label: 'Billing & Plan' },
]
const OFFICE_SECTIONS = new Set<SettingsSection>(['office', 'finance', 'integrations', 'billing'])

export default function Settings({ section }: { section: SettingsSection }) {
  const { currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false

  if (OFFICE_SECTIONS.has(section) && !isAdmin) {
    return <Navigate to="/settings/profile" replace />
  }

  if (OFFICE_SECTIONS.has(section)) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Office settings</h1>
          <p>Everything that belongs to the organization — its profile, money rules, connected apps and subscription.</p>
        </div>
        <div className="cycle-toggle" style={{ marginBottom: 24, flexWrap: 'wrap' }}>
          {OFFICE_TABS.map((t) => (
            <NavLink key={t.section} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')} end>
              {t.label}
            </NavLink>
          ))}
        </div>
        {section === 'office' && <OfficeSettings />}
        {section === 'finance' && <FinanceSettings />}
        {section === 'integrations' && <IntegrationsSettings />}
        {section === 'billing' && <Billing />}
      </div>
    )
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
    </div>
  )
}
