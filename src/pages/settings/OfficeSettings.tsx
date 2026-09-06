import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

function initials(name: string | undefined | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}

// Admin-only. The office name + logo shown across the app (sidebar brand,
// mobile bar, office switcher). Logo is a hosted image URL rather than an
// upload — there's no org-logo storage bucket, and logo_url is just a text
// column consumed directly as an <img src>.
export default function OfficeSettings() {
  const { currentMembership, refresh } = useAuth()
  const org = currentMembership?.organization

  const [name, setName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [imgFailed, setImgFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!org) return
    setName(org.name ?? '')
    setLogoUrl(org.logo_url ?? '')
  }, [org])

  useEffect(() => {
    setImgFailed(false)
  }, [logoUrl])

  if (!org) return null

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!org) return
    if (!name.trim()) {
      setError('Office name is required.')
      return
    }
    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      const { error: updateErr } = await supabase
        .from('organizations')
        .update({ name: name.trim(), logo_url: logoUrl.trim() || null })
        .eq('id', org.id)
      if (updateErr) throw updateErr
      setNotice('Office updated.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save office settings.')
    } finally {
      setSaving(false)
    }
  }

  const showLogo = logoUrl.trim() && !imgFailed

  return (
    <div>
      <div className="page-head">
        <h1>Office</h1>
        <p>Your office name and logo, shown across the workspace.</p>
      </div>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-info">{notice}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        {showLogo ? (
          <img
            className="avatar"
            style={{ width: 72, height: 72, borderRadius: 14, objectFit: 'cover' }}
            src={logoUrl.trim()}
            onError={() => setImgFailed(true)}
            alt=""
          />
        ) : (
          <div className="avatar" style={{ width: 72, height: 72, borderRadius: 14, fontSize: 22 }}>
            {initials(name || org.name)}
          </div>
        )}
        <p style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>
          Preview. Paste a hosted image link below (square works best).
        </p>
      </div>

      <form onSubmit={handleSave} style={{ maxWidth: 480 }}>
        <label>
          Office name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <label>
          Logo URL
          <input
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…/logo.png"
          />
        </label>

        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form>
    </div>
  )
}
