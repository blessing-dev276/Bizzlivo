import { useState } from 'react'
import { useAuth } from '../../lib/AuthContext'
import Billing from '../billing/Billing'
import ProfileSettings from './ProfileSettings'
import OfficeSettings from './OfficeSettings'

// Profile is for everyone; Office and Billing are admin-only. Add more
// <button>/section pairs here as they're built.
type Section = 'profile' | 'office' | 'billing'

const ADMIN_ROLES = new Set(['admin'])

export default function Settings() {
  const { currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false
  const [section, setSection] = useState<Section>('profile')

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <div className="cycle-toggle" style={{ marginBottom: 24 }}>
        <button type="button" className={section === 'profile' ? 'active' : ''} onClick={() => setSection('profile')}>
          Profile
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
      {section === 'office' && isAdmin && <OfficeSettings />}
      {section === 'billing' && isAdmin && <Billing />}
    </div>
  )
}
