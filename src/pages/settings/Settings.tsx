import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import Billing from '../billing/Billing'
import ProfileSettings from './ProfileSettings'
import OfficeSettings from './OfficeSettings'
import NotificationSettings from './NotificationSettings'
import SecuritySettings from './SecuritySettings'
import MembershipDanger from './MembershipDanger'

// Profile + Notifications are for everyone; Office and Billing are admin-only.
type Section = 'profile' | 'notifications' | 'security' | 'office' | 'billing'
const SECTIONS: Section[] = ['profile', 'notifications', 'security', 'office', 'billing']

const ADMIN_ROLES = new Set(['admin'])

export default function Settings() {
  const { currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false

  // The active tab lives in the URL (?tab=billing) so links elsewhere in
  // the app — "Upgrade" buttons especially — can deep-link straight to a
  // section instead of a standalone page.
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') as Section | null
  const isAllowed = requested != null && SECTIONS.includes(requested) && (!['office', 'billing'].includes(requested) || isAdmin)
  const section: Section = isAllowed ? (requested as Section) : 'profile'

  const setSection = (next: Section) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'profile') p.delete('tab')
        else p.set('tab', next)
        return p
      },
      { replace: true },
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <div className="cycle-toggle" style={{ marginBottom: 24 }}>
        <button type="button" className={section === 'profile' ? 'active' : ''} onClick={() => setSection('profile')}>
          Profile
        </button>
        <button type="button" className={section === 'notifications' ? 'active' : ''} onClick={() => setSection('notifications')}>
          Notifications
        </button>
        <button type="button" className={section === 'security' ? 'active' : ''} onClick={() => setSection('security')}>
          Security
        </button>
        {isAdmin && (
          <button type="button" className={section === 'office' ? 'active' : ''} onClick={() => setSection('office')}>
            Office
          </button>
        )}
        {isAdmin && (
          <button type="button" className={section === 'billing' ? 'active' : ''} onClick={() => setSection('billing')}>
            Billing
          </button>
        )}
      </div>

      {section === 'profile' && <ProfileSettings />}
      {section === 'notifications' && <NotificationSettings />}
      {section === 'security' && <SecuritySettings />}
      {section === 'office' && isAdmin && <OfficeSettings />}
      {section === 'billing' && isAdmin && <Billing />}

      {(section === 'profile' || section === 'office') && <MembershipDanger />}
    </div>
  )
}
