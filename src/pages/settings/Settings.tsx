import { useState } from 'react'
import Billing from '../billing/Billing'
import ProfileSettings from './ProfileSettings'

// Profile and Billing are the real sections today — notifications/security
// aren't built yet, so this stays a small shell rather than inventing empty
// placeholder sections nobody asked for. Add more <button>/section pairs
// here as they're built.
type Section = 'profile' | 'billing'

export default function Settings() {
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
        <button type="button" className={section === 'billing' ? 'active' : ''} onClick={() => setSection('billing')}>
          Billing
        </button>
      </div>

      {section === 'profile' && <ProfileSettings />}
      {section === 'billing' && <Billing />}
    </div>
  )
}
