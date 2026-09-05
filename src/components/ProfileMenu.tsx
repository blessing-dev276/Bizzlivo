import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { uploadAvatar, validateAvatarFile } from '../lib/avatar'

function initials(name: string | undefined | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}

export default function ProfileMenu() {
  const { profile, refresh, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile) return
    const validationError = validateAvatarFile(file)
    if (validationError) {
      setUploadError(validationError)
      return
    }
    setUploadError(null)
    setUploading(true)
    try {
      await uploadAvatar(profile.id, file)
      setImgFailed(false)
      await refresh()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not upload photo.')
    } finally {
      setUploading(false)
    }
  }

  const showPhoto = profile?.avatar_url && !imgFailed

  return (
    <div className="kebab-wrap">
      <button type="button" className="profile-chip" onClick={() => setOpen((v) => !v)}>
        {showPhoto ? (
          <img className="avatar profile-chip-avatar" src={profile!.avatar_url!} onError={() => setImgFailed(true)} alt="" />
        ) : (
          <div className="avatar profile-chip-avatar" title={profile?.full_name ?? ''}>{initials(profile?.full_name)}</div>
        )}
        <span className="profile-chip-name">{profile?.full_name ?? '…'}</span>
        <svg className="profile-chip-chevron" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div className="kebab-menu profile-menu-dropdown">
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Change photo'}
            </button>
            <button type="button" className="danger-item" onClick={handleSignOut}>Sign out</button>
            {uploadError && <p className="form-error" style={{ padding: '0 4px' }}>{uploadError}</p>}
          </div>
        </>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
    </div>
  )
}
