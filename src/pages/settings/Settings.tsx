import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import Billing from '../billing/Billing'
import ProfileSettings from './ProfileSettings'
import OfficeSettings from './OfficeSettings'
import NotificationSettings from './NotificationSettings'
import SecuritySettings from './SecuritySettings'
import MembershipDanger from './MembershipDanger'

const ADMIN_ROLES = new Set(['admin'])

export default function Settings() {
  const { currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false

  // Everything is on one page now. Links elsewhere (the "Upgrade" buttons
  // especially) still pass ?tab=billing — jump to that section on load.
  const [params] = useSearchParams()
  const tab = params.get('tab')
  useEffect(() => {
    if (!tab) return
    document.getElementById(`settings-${tab}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [tab])

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <section id="settings-profile" style={{ scrollMarginTop: 20 }}>
        <ProfileSettings />
      </section>
      <section id="settings-notifications" style={{ scrollMarginTop: 20 }}>
        <NotificationSettings />
      </section>
      <section id="settings-security" style={{ scrollMarginTop: 20 }}>
        <SecuritySettings />
      </section>
      {isAdmin && (
        <section id="settings-office" style={{ scrollMarginTop: 20 }}>
          <OfficeSettings />
        </section>
      )}
      {isAdmin && (
        <section id="settings-billing" style={{ scrollMarginTop: 20 }}>
          <Billing />
        </section>
      )}

      <MembershipDanger />
    </div>
  )
}
