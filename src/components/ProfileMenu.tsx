import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

function initials(name: string | undefined | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}

// The topbar profile chip — no dropdown; clicking it opens the profile page.
// Sign-out lives in the sidebar; changing the photo lives on the profile page.
export default function ProfileMenu() {
  const { profile, currentMembership } = useAuth()
  const navigate = useNavigate()
  const [imgFailed, setImgFailed] = useState(false)

  const showPhoto = profile?.avatar_url && !imgFailed

  return (
    <button
      type="button"
      className="profile-chip"
      onClick={() => navigate('/settings')}
      title="Profile & settings"
    >
      {showPhoto ? (
        <img className="avatar profile-chip-avatar" src={profile!.avatar_url!} onError={() => setImgFailed(true)} alt="" />
      ) : (
        <div className="avatar profile-chip-avatar" title={profile?.full_name ?? ''}>{initials(profile?.full_name)}</div>
      )}
      <span className="profile-chip-id">
        <span className="profile-chip-name">{profile?.full_name ?? '…'}</span>
        {currentMembership && <span className="profile-chip-role">{currentMembership.role.replace('_', ' ')}</span>}
      </span>
    </button>
  )
}
