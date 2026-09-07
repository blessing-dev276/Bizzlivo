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
const ROOT_DOMAIN = 'bizzlivo.com'
const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD']

interface OrgSettingsRow {
  name: string
  logo_url: string | null
  brand_color: string | null
  whatsapp_number: string | null
  slug: string
  plan_tier: string
  base_currency: string | null
  min_withdrawal_amount: number | string | null
  withdrawal_requires_approval: boolean | null
  allow_member_cancel_withdrawal: boolean | null
}

// Admin-only. Office name + contact + finance rules are free on every plan;
// custom logo + brand colour are the `custom_branding` entitlement (Business).
export default function OfficeSettings() {
  const { currentMembership, refresh } = useAuth()
  const org = currentMembership?.organization
  const { usage } = useOrgUsage(org?.id)
  const canBrand = !!usage?.custom_branding

  const [name, setName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [brandColor, setBrandColor] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [slug, setSlug] = useState('')
  const [baseCurrency, setBaseCurrency] = useState('NGN')
  const [minWithdrawal, setMinWithdrawal] = useState('0')
  const [requiresApproval, setRequiresApproval] = useState(true)
  const [allowCancel, setAllowCancel] = useState(true)

  const [imgFailed, setImgFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!org) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('organizations')
        .select(
          'name, logo_url, brand_color, whatsapp_number, slug, plan_tier, base_currency, min_withdrawal_amount, withdrawal_requires_approval, allow_member_cancel_withdrawal',
        )
        .eq('id', org.id)
        .maybeSingle()
      if (cancelled) return
      const o = (data as OrgSettingsRow | null) ?? null
      setName(o?.name ?? org.name ?? '')
      setLogoUrl(o?.logo_url ?? '')
      setBrandColor(o?.brand_color ?? '')
      setWhatsapp(o?.whatsapp_number ?? '')
      setSlug(o?.slug ?? org.slug ?? '')
      setBaseCurrency(o?.base_currency ?? 'NGN')
      setMinWithdrawal(String(o?.min_withdrawal_amount ?? 0))
      setRequiresApproval(o?.withdrawal_requires_approval ?? true)
      setAllowCancel(o?.allow_member_cancel_withdrawal ?? true)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
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
    const minVal = Number(minWithdrawal)
    if (!Number.isFinite(minVal) || minVal < 0) {
      setError('Minimum withdrawal must be zero or more.')
      return
    }
    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      const patch: Record<string, unknown> = {
        name: name.trim(),
        whatsapp_number: whatsapp.trim() || null,
        base_currency: baseCurrency,
        min_withdrawal_amount: minVal,
        withdrawal_requires_approval: requiresApproval,
        allow_member_cancel_withdrawal: allowCancel,
      }
      if (canBrand) {
        patch.logo_url = logoUrl.trim() || null
        patch.brand_color = brandColor.trim() || null
      }
      const { error: updateErr } = await supabase.from('organizations').update(patch).eq('id', org.id)
      if (updateErr) throw updateErr
      setNotice('Office settings saved.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save office settings.')
    } finally {
      setSaving(false)
    }
  }

  const showLogo = canBrand && logoUrl.trim() && !imgFailed
  const officeUrl = slug ? `https://${slug}.${ROOT_DOMAIN}` : ''
  const loginUrl = slug ? `${officeUrl}/o/${slug}/login` : ''

  async function copyOfficeUrl() {
    if (!officeUrl) return
    try {
      await navigator.clipboard.writeText(officeUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  if (loading) return <p className="empty-row">Loading…</p>

  return (
    <div>
      <div className="page-head">
        <h1>Office</h1>
        <p>How your office shows up across the workspace, how members reach you, and the rules that govern payouts.</p>
      </div>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-info">{notice}</p>}

      <form onSubmit={handleSave} className="set-sections">
        {/* ---------------- Identity ---------------- */}
        <section className="set-card">
          <div className="set-card-head">
            <h2>Identity</h2>
            <p>Your office name{canBrand ? ', logo and brand colour' : ''} — shown to every member.</p>
          </div>

          <div className="set-identity">
            {showLogo ? (
              <img
                className="avatar"
                style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'cover' }}
                src={logoUrl.trim()}
                onError={() => setImgFailed(true)}
                alt=""
              />
            ) : (
              <div className="avatar" style={{ width: 64, height: 64, borderRadius: 14, fontSize: 20 }}>
                {initials(name || org.name)}
              </div>
            )}
            <div className="set-field-col">
              <label>
                Office name
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
            </div>
          </div>

          {canBrand ? (
            <div className="set-field-grid">
              <label>
                Logo URL
                <input type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
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
                  <input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} placeholder="#2563eb" style={{ flex: 1 }} />
                  {brandColor && (
                    <button type="button" className="btn-ghost" onClick={() => setBrandColor('')}>Reset</button>
                  )}
                </span>
              </label>
            </div>
          ) : (
            <div className="entitlement-lock">
              <div>
                <strong>Custom logo &amp; brand colour</strong>
                <p>Available on the Business plan — replace the Bizzlivo mark with your own across the workspace.</p>
              </div>
              <Link to="/billing" className="btn-primary-link">Upgrade</Link>
            </div>
          )}
        </section>

        {/* ---------------- Contact ---------------- */}
        <section className="set-card">
          <div className="set-card-head">
            <h2>Contact</h2>
            <p>Where members turn when they need a person. Shown on support and onboarding screens.</p>
          </div>
          <label style={{ maxWidth: 360 }}>
            WhatsApp / support number
            <input
              type="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+234 800 000 0000"
            />
          </label>
        </section>

        {/* ---------------- Address (read-only) ---------------- */}
        <section className="set-card">
          <div className="set-card-head">
            <h2>Office address</h2>
            <p>Your office lives on its own subdomain. Members sign in here.</p>
          </div>
          <div className="set-address">
            <code className="set-url">{officeUrl || `${slug || 'your-office'}.${ROOT_DOMAIN}`}</code>
            <button type="button" className="btn-ghost" onClick={copyOfficeUrl} disabled={!officeUrl}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <span className={`badge ${org.plan_tier !== 'free' ? 'active' : ''}`} style={{ marginLeft: 'auto' }}>
              {org.plan_tier} plan
            </span>
          </div>
          {loginUrl && (
            <p className="set-hint">
              Direct sign-in link: <a href={loginUrl}>{loginUrl}</a>
            </p>
          )}
        </section>

        {/* ---------------- Finance rules ---------------- */}
        <section className="set-card">
          <div className="set-card-head">
            <h2>Finance</h2>
            <p>
              The base currency for office reporting and the rules members follow when they request a payout in the{' '}
              <Link to="/finance">Finance workspace</Link>.
            </p>
          </div>

          <div className="set-field-grid">
            <label>
              Base currency
              <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Minimum withdrawal ({baseCurrency})
              <input
                type="number"
                min="0"
                step="0.01"
                value={minWithdrawal}
                onChange={(e) => setMinWithdrawal(e.target.value)}
              />
            </label>
          </div>

          <label className="set-toggle">
            <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
            <span>
              <strong>Require admin approval for withdrawals</strong>
              <span className="set-hint">When off, member requests move straight to processing. Recommended: on.</span>
            </span>
          </label>
          <label className="set-toggle">
            <input type="checkbox" checked={allowCancel} onChange={(e) => setAllowCancel(e.target.checked)} />
            <span>
              <strong>Let members cancel a pending withdrawal</strong>
              <span className="set-hint">Members can withdraw their request while it is still awaiting approval.</span>
            </span>
          </label>
        </section>

        <div className="set-actions">
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  )
}
