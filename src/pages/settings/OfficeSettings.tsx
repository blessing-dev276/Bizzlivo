import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { useOrgUsage } from '../../lib/plans'

function initials(name: string | undefined | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}

const HEX_RE = /^#([0-9a-f]{6})$/i

// Admin-only. Office name is free on every plan. Custom logo + brand colour
// are the `custom_branding` entitlement (Business) — gated here in the UI;
// the columns simply stay unset for lower plans.
export default function OfficeSettings() {
  const { currentMembership, refresh } = useAuth()
  const org = currentMembership?.organization
  const { usage } = useOrgUsage(org?.id)
  const canBrand = !!usage?.custom_branding

  const [name, setName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [brandColor, setBrandColor] = useState('')
  const [imgFailed, setImgFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!org) return
    setName(org.name ?? '')
    setLogoUrl(org.logo_url ?? '')
    setBrandColor(org.brand_color ?? '')
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
    if (canBrand && brandColor && !HEX_RE.test(brandColor)) {
      setError('Brand colour must be a hex value like #2563eb.')
      return
    }
    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      const patch: Record<string, unknown> = { name: name.trim() }
      if (canBrand) {
        patch.logo_url = logoUrl.trim() || null
        patch.brand_color = brandColor.trim() || null
      }
      const { error: updateErr } = await supabase.from('organizations').update(patch).eq('id', org.id)
      if (updateErr) throw updateErr
      setNotice('Office updated.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save office settings.')
    } finally {
      setSaving(false)
    }
  }

  const showLogo = canBrand && logoUrl.trim() && !imgFailed

  return (
    <div>
      <div className="page-head">
        <h1>Office</h1>
        <p>Your office name{canBrand ? ', logo and brand colour' : ''}, shown across the workspace.</p>
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
        {canBrand && (
          <p style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>
            Preview. Paste a hosted image link below (square works best).
          </p>
        )}
      </div>

      <form onSubmit={handleSave} style={{ maxWidth: 480 }}>
        <label>
          Office name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        {canBrand ? (
          <>
            <label>
              Logo URL
              <input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://…/logo.png"
              />
            </label>
            <label>
              Brand colour
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="color"
                  value={HEX_RE.test(brandColor) ? brandColor : '#2563eb'}
                  onChange={(e) => setBrandColor(e.target.value)}
                  style={{ width: 44, height: 34, padding: 2, borderRadius: 8 }}
                />
                <input
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  placeholder="#2563eb"
                  style={{ flex: 1 }}
                />
                {brandColor && (
                  <button type="button" className="btn-ghost" onClick={() => setBrandColor('')}>Reset</button>
                )}
              </span>
            </label>
          </>
        ) : (
          <div className="entitlement-lock">
            <div>
              <strong>Custom logo &amp; brand colour</strong>
              <p>Available on the Business plan — replace the Bizzlivo mark with your own across the workspace.</p>
            </div>
            <Link to="/billing" className="btn-primary-link">Upgrade</Link>
          </div>
        )}

        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form>
    </div>
  )
}
