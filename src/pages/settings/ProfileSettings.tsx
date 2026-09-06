import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { uploadAvatar, validateAvatarFile } from '../../lib/avatar'

interface MemberOption {
  id: string
  full_name: string
}

type SponsorMode = 'member' | 'other'

// NeoLife distributor levels — the fixed set shown in the profile Status field.
const PROFILE_STATUSES = [
  'Distributor',
  'Manager',
  'Senior Manager',
  'Executive Manager',
  'Director',
  'Emerald Director',
  'Sapphire Director',
]

function initials(name: string | undefined | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}

export default function ProfileSettings() {
  const { profile, currentMembership, refresh } = useAuth()
  const orgId = currentMembership?.organization.id
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [members, setMembers] = useState<MemberOption[]>([])
  const [imgFailed, setImgFailed] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState('')
  const [sponsorMode, setSponsorMode] = useState<SponsorMode>('member')
  const [sponsorMemberId, setSponsorMemberId] = useState('')
  const [sponsorName, setSponsorName] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId || !profile) return
    supabase
      .from('memberships')
      .select('id, profile:profiles(id, full_name)')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .then(({ data }) => {
        const rows = (data as unknown as { profile: MemberOption }[]) ?? []
        setMembers(rows.map((r) => r.profile).filter((p) => p.id !== profile.id))
      })
  }, [orgId, profile])

  useEffect(() => {
    if (!profile) return
    setFullName(profile.full_name ?? '')
    setPhone(profile.phone ?? '')
    setStatus(profile.status ?? '')
    if (profile.sponsor_member_id) {
      setSponsorMode('member')
      setSponsorMemberId(profile.sponsor_member_id)
    } else if (profile.sponsor_name) {
      setSponsorMode('other')
      setSponsorName(profile.sponsor_name)
    }
  }, [profile])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile) return
    const validationError = validateAvatarFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setUploading(true)
    try {
      await uploadAvatar(profile.id, file)
      setImgFailed(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload photo.')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    if (!fullName.trim()) {
      setError('Full name is required.')
      return
    }
    if (sponsorMode === 'member' && !sponsorMemberId) {
      setError('Pick a sponsor from the member list, or switch to "Not in the Virtual Office" and type their name.')
      return
    }
    if (sponsorMode === 'other' && !sponsorName.trim()) {
      setError('Enter your sponsor\'s name.')
      return
    }

    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          status: status.trim() || null,
          sponsor_member_id: sponsorMode === 'member' ? sponsorMemberId : null,
          sponsor_name: sponsorMode === 'other' ? sponsorName.trim() : null,
        })
        .eq('id', profile.id)
      if (updateErr) throw updateErr
      setNotice('Profile updated.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile.')
    } finally {
      setSaving(false)
    }
  }

  if (!profile) return null

  const showPhoto = profile.avatar_url && !imgFailed
  const currentSponsorLabel = profile.sponsor_member_id
    ? members.find((m) => m.id === profile.sponsor_member_id)?.full_name ?? 'Loading…'
    : profile.sponsor_name
      ? `${profile.sponsor_name} (not in the Virtual Office)`
      : 'Not set'

  return (
    <div>
      <div className="page-head">
        <h1>Profile</h1>
        <p>Your photo, status, and sponsor.</p>
      </div>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-info">{notice}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        {showPhoto ? (
          <img
            className="avatar"
            style={{ width: 72, height: 72, fontSize: 22, objectFit: 'cover' }}
            src={profile.avatar_url!}
            onError={() => setImgFailed(true)}
            alt=""
          />
        ) : (
          <div className="avatar" style={{ width: 72, height: 72, fontSize: 22 }}>{initials(profile.full_name)}</div>
        )}
        <div>
          <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Change photo'}
          </button>
          <p style={{ color: 'var(--text-faint)', fontSize: 12.5, marginTop: 6 }}>JPG or PNG, up to 5MB.</p>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

      <form onSubmit={handleSave} style={{ maxWidth: 480 }}>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>

        <label>
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
        </label>

        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Not set</option>
            {PROFILE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label>
          Sponsor
          <div className="cycle-toggle" style={{ marginBottom: 8 }}>
            <button type="button" className={sponsorMode === 'member' ? 'active' : ''} onClick={() => setSponsorMode('member')}>
              Virtual Office member
            </button>
            <button type="button" className={sponsorMode === 'other' ? 'active' : ''} onClick={() => setSponsorMode('other')}>
              Not in the Virtual Office
            </button>
          </div>
          {sponsorMode === 'member' ? (
            <select value={sponsorMemberId} onChange={(e) => setSponsorMemberId(e.target.value)}>
              <option value="">Select a member…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          ) : (
            <input value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} placeholder="Sponsor's name" />
          )}
        </label>

        <p style={{ color: 'var(--text-faint)', fontSize: 12.5, marginTop: -6, marginBottom: 18 }}>
          Currently: {currentSponsorLabel}
        </p>

        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form>
    </div>
  )
}
