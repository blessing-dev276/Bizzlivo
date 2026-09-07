import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { useOrgUsage } from '../../lib/plans'
import { officeLoginUrl } from '../../lib/tenant'
import { uploadOfficeLogo, clearOfficeLogo, validateLogoFile } from '../../lib/officeLogo'

function initials(name: string | undefined | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase()
}

const HEX_RE = /^#([0-9a-f]{6})$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD']

// Kept short and practical — the offices using Bizzlivo today. "Other" lets
// anyone else through without us maintaining an ISO list.
const COUNTRIES = [
  'Nigeria', 'Ghana', 'Kenya', 'South Africa', 'Uganda', 'Tanzania', 'Rwanda',
  'Cameroon', 'Côte d’Ivoire', 'Senegal', 'Egypt', 'Ethiopia', 'Zambia',
  'United Kingdom', 'United States', 'Canada', 'India', 'United Arab Emirates', 'Other',
]

function timezoneOptions(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (all && all.length) return all
  } catch {
    /* older browsers — fall through */
  }
  return [
    'Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo',
    'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'UTC',
  ]
}

function normaliseWebsite(value: string): string {
  const v = value.trim()
  if (!v) return ''
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

interface OrgSettingsRow {
  name: string
  tagline: string | null
  about: string | null
  logo_url: string | null
  brand_color: string | null
  support_email: string | null
  whatsapp_number: string | null
  website_url: string | null
  address: string | null
  country: string | null
  timezone: string | null
  slug: string
  plan_tier: string
  base_currency: string | null
  min_withdrawal_amount: number | string | null
  withdrawal_requires_approval: boolean | null
  allow_member_cancel_withdrawal: boolean | null
}

const TZ_OPTIONS = timezoneOptions()

// Admin-only. Name / tagline / about / contact / location / finance rules are
// free on every plan; a custom logo + brand colour are the `custom_branding`
// entitlement (Business).
export default function OfficeSettings() {
  const { currentMembership, refresh } = useAuth()
  const org = currentMembership?.organization
  const { usage } = useOrgUsage(org?.id)
  const canBrand = !!usage?.custom_branding

  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [about, setAbout] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [brandColor, setBrandColor] = useState('')
  const [supportEmail, setSupportEmail] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [website, setWebsite] = useState('')
  const [address, setAddress] = useState('')
  const [country, setCountry] = useState('')
  const [timezone, setTimezone] = useState('')
  const [slug, setSlug] = useState('')
  const [baseCurrency, setBaseCurrency] = useState('NGN')
  const [minWithdrawal, setMinWithdrawal] = useState('0')
  const [requiresApproval, setRequiresApproval] = useState(true)
  const [allowCancel, setAllowCancel] = useState(true)

  const [imgFailed, setImgFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!org) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('organizations')
        .select(
          'name, tagline, about, logo_url, brand_color, support_email, whatsapp_number, website_url, address, country, timezone, slug, plan_tier, base_currency, min_withdrawal_amount, withdrawal_requires_approval, allow_member_cancel_withdrawal',
        )
        .eq('id', org.id)
        .maybeSingle()
      if (cancelled) return
      const o = (data as OrgSettingsRow | null) ?? null
      setName(o?.name ?? org.name ?? '')
      setTagline(o?.tagline ?? '')
      setAbout(o?.about ?? '')
      setLogoUrl(o?.logo_url ?? '')
      setBrandColor(o?.brand_color ?? '')
      setSupportEmail(o?.support_email ?? '')
      setWhatsapp(o?.whatsapp_number ?? '')
      setWebsite(o?.website_url ?? '')
      setAddress(o?.address ?? '')
      setCountry(o?.country ?? '')
      setTimezone(o?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? '')
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

  async function handleLogoPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file || !org) return
    const bad = validateLogoFile(file)
    if (bad) {
      setError(bad)
      return
    }
    setError(null)
    setNotice(null)
    setUploadingLogo(true)
    try {
      const url = await uploadOfficeLogo(org.id, file)
      setLogoUrl(url)
      setNotice('Logo updated.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the logo.')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleLogoRemove() {
    if (!org) return
    setUploadingLogo(true)
    setError(null)
    try {
      await clearOfficeLogo(org.id)
      setLogoUrl('')
      setNotice('Logo removed.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the logo.')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!org) return
    if (!name.trim()) {
      setError('Office name is required.')
      return
    }
    if (supportEmail.trim() && !EMAIL_RE.test(supportEmail.trim())) {
      setError('Support email doesn’t look right.')
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
        tagline: tagline.trim() || null,
        about: about.trim() || null,
        support_email: supportEmail.trim() || null,
        whatsapp_number: whatsapp.trim() || null,
        website_url: normaliseWebsite(website) || null,
        address: address.trim() || null,
        country: country || null,
        timezone: timezone || null,
        base_currency: baseCurrency,
        min_withdrawal_amount: minVal,
        withdrawal_requires_approval: requiresApproval,
        allow_member_cancel_withdrawal: allowCancel,
      }
      if (canBrand) {
        patch.brand_color = brandColor.trim() || null
      }
      const { error: updateErr } = await supabase.from('organizations').update(patch).eq('id', org.id)
      if (updateErr) throw updateErr
      setWebsite(normaliseWebsite(website))
      setNotice('Office settings saved.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save office settings.')
    } finally {
      setSaving(false)
    }
  }

  const showLogo = canBrand && logoUrl.trim() && !imgFailed
  const officeUrl = officeLoginUrl(slug)

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
            <p>Your office name and one-line summary — shown to every member and on your sign-in page.</p>
          </div>

          <div className="set-identity">
            {showLogo ? (
              <img
                className="avatar"
                style={{ width: 72, height: 72, borderRadius: 16, objectFit: 'cover' }}
                src={logoUrl.trim()}
                onError={() => setImgFailed(true)}
                alt=""
              />
            ) : (
              <div className="avatar" style={{ width: 72, height: 72, borderRadius: 16, fontSize: 22 }}>
                {initials(name || org.name)}
              </div>
            )}

            <div className="set-field-col" style={{ flex: 1 }}>
              <label>
                Office name
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label>
                Tagline <span className="set-hint">Optional — e.g. “Building leaders in Lagos.”</span>
                <input
                  value={tagline}
                  maxLength={80}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="One line about your office"
                />
              </label>
            </div>
          </div>

          {/* logo control */}
          {canBrand ? (
            <div className="set-field-grid">
              <div className="set-field-col">
                <span className="set-label">Office logo</span>
                <span className="set-hint">PNG, JPG or SVG. Square works best. Max 5MB.</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoPick}
                  hidden
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadingLogo}>
                    {uploadingLogo ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
                  </button>
                  {logoUrl && (
                    <button type="button" className="btn-ghost" onClick={handleLogoRemove} disabled={uploadingLogo}>
                      Remove
                    </button>
                  )}
                </div>
              </div>

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
              <Link to="/settings/billing" className="btn-primary-link">Upgrade</Link>
            </div>
          )}
        </section>

        {/* ---------------- About ---------------- */}
        <section className="set-card">
          <div className="set-card-head">
            <h2>About</h2>
            <p>A short description of what your office does. Shown on onboarding and your sign-in page.</p>
          </div>
          <label>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              rows={4}
              maxLength={600}
              placeholder="Tell new members what your office is about, what you sell, and what to expect."
            />
            <span className="set-hint">{about.length}/600</span>
          </label>
        </section>

        {/* ---------------- Contact ---------------- */}
        <section className="set-card">
          <div className="set-card-head">
            <h2>Contact</h2>
            <p>Where members turn when they need a person. Shown on support and onboarding screens.</p>
          </div>
          <div className="set-field-grid">
            <label>
              Support email
              <input
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                placeholder="support@youroffice.com"
              />
            </label>
            <label>
              WhatsApp / phone
              <input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="+234 800 000 0000"
              />
            </label>
            <label>
              Website
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="youroffice.com"
              />
            </label>
          </div>
        </section>

        {/* ---------------- Location ---------------- */}
        <section className="set-card">
          <div className="set-card-head">
            <h2>Location</h2>
            <p>Used for reporting dates and shown on your office profile.</p>
          </div>
          <div className="set-field-grid">
            <label>
              Country
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">Not set</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Timezone
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value="">Not set</option>
                {TZ_OPTIONS.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Address <span className="set-hint">Optional</span>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              placeholder="Street, city, state"
            />
          </label>
        </section>

        {/* ---------------- Sign-in link ---------------- */}
        <section className="set-card">
          <div className="set-card-head">
            <h2>Office sign-in link</h2>
            <p>Share this with members — it opens your office's branded login page.</p>
          </div>
          <div className="set-address">
            <code className="set-url">{officeUrl || `.../o/${slug || 'your-office'}/login`}</code>
            <button type="button" className="btn-ghost" onClick={copyOfficeUrl} disabled={!officeUrl}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <span className={`badge ${org.plan_tier !== 'free' ? 'active' : ''}`} style={{ marginLeft: 'auto' }}>
              {org.plan_tier} plan
            </span>
          </div>
          {officeUrl && (
            <p className="set-hint">
              Opens <a href={officeUrl}>{officeUrl}</a>
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
