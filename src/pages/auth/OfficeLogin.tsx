import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { notifyOrgAdmins } from '../../lib/notifications'
import ThemeToggle from '../../components/ThemeToggle'

interface OrgBranding {
  id: string
  name: string
}

type Mode = 'login' | 'join'

// Reached two ways: the legacy path /o/:slug/login (slug from the route),
// or the root of an office's own subdomain (slug resolved from the
// hostname by OfficeAwareRoot in App.tsx and passed in directly since
// there's no route param there). The path param wins if both are somehow
// present.
export default function OfficeLogin({ slugOverride }: { slugOverride?: string } = {}) {
  const { slug: pathSlug } = useParams<{ slug: string }>()
  const slug = pathSlug ?? slugOverride
  const navigate = useNavigate()
  const { refresh, memberships, setCurrentOrgId } = useAuth()

  const [org, setOrg] = useState<OrgBranding | null>(null)
  const [loadingOrg, setLoadingOrg] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [mode, setMode] = useState<Mode>('login')

  // login
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // join request
  const [joinName, setJoinName] = useState('')
  const [joinEmail, setJoinEmail] = useState('')
  const [joinPhone, setJoinPhone] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joinSubmitting, setJoinSubmitting] = useState(false)
  const [joinSent, setJoinSent] = useState(false)

  useEffect(() => {
    if (!slug) return
    supabase
      .from('organizations')
      .select('id, name')
      .eq('slug', slug)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) setNotFound(true)
        else setOrg(data as OrgBranding)
        setLoadingOrg(false)
      })
  }, [slug])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!org) return
    setError(null)
    setSubmitting(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(signInError.message)
      setSubmitting(false)
      return
    }

    await refresh()
    const belongsHere = memberships.some((m) => m.org_id === org.id) || (await checkMembership(org.id))
    if (!belongsHere) {
      setError(`This account isn't a member of ${org.name}. Ask your office admin for an invite.`)
      await supabase.auth.signOut()
      setSubmitting(false)
      return
    }

    setCurrentOrgId(org.id)
    navigate('/')
  }

  // memberships state may not have re-rendered yet right after refresh() resolves —
  // fall back to a direct check so a first-login-attempt doesn't false-negative.
  async function checkMembership(orgId: string) {
    const { data } = await supabase.auth.getUser()
    if (!data.user) return false
    const { data: membership } = await supabase
      .from('memberships')
      .select('id')
      .eq('org_id', orgId)
      .eq('user_id', data.user.id)
      .eq('status', 'active')
      .maybeSingle()
    return !!membership
  }

  async function handleJoinRequest(e: FormEvent) {
    e.preventDefault()
    if (!org) return
    setJoinError(null)
    setJoinSubmitting(true)

    const { error: insertError } = await supabase.from('pending_members').insert({
      org_id: org.id,
      full_name: joinName.trim(),
      email: joinEmail.trim(),
      phone: joinPhone.trim() || null,
    })

    setJoinSubmitting(false)
    if (insertError) {
      setJoinError(insertError.message)
      return
    }
    setJoinSent(true)

    try {
      await notifyOrgAdmins(org.id, 'join_request', {
        text: `${joinName.trim()} requested to join ${org.name}`,
        link: '/invites',
      })
    } catch {
      // Non-fatal — the join request itself already succeeded.
    }
  }

  if (loadingOrg) {
    return (
      <div className="auth-page">
        <div className="auth-card"><p>Loading…</p></div>
      </div>
    )
  }

  if (notFound || !org) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Office not found</h1>
          <p className="form-error">No office matches this link. Check the URL your admin gave you.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="blob blob-a" />
      <div className="blob blob-b" />
      <div className="auth-theme-toggle">
        <ThemeToggle />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 380 }}>
        <div className="auth-logo" style={{ flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 22 }}>{org.name}</span>
          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            powered by HQ360
          </span>
        </div>

        {mode === 'login' ? (
          <form className="auth-card" onSubmit={handleSubmit}>
            <h1>Log in</h1>

            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>

            {error && <p className="form-error">{error}</p>}

            <button type="submit" disabled={submitting}>
              {submitting ? 'Logging in…' : 'Log in'}
            </button>

            <p className="auth-switch">
              New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode('join') }}>Request to join {org.name}</a>
            </p>
          </form>
        ) : (
          <form className="auth-card" onSubmit={handleJoinRequest}>
            <h1>Join {org.name}</h1>
            <p className="auth-subtitle">Your request goes to the office admin for approval.</p>

            {joinSent ? (
              <p className="form-info">
                Request sent — {org.name}'s admin will review it and send you an invite to set up your account.
              </p>
            ) : (
              <>
                <label>
                  Your name
                  <input value={joinName} onChange={(e) => setJoinName(e.target.value)} required autoFocus />
                </label>
                <label>
                  Email
                  <input type="email" value={joinEmail} onChange={(e) => setJoinEmail(e.target.value)} required />
                </label>
                <label>
                  WhatsApp number
                  <input value={joinPhone} onChange={(e) => setJoinPhone(e.target.value)} placeholder="e.g. 08012345678" />
                </label>

                {joinError && <p className="form-error">{joinError}</p>}

                <button type="submit" disabled={joinSubmitting}>
                  {joinSubmitting ? 'Sending…' : 'Send request'}
                </button>
              </>
            )}

            <p className="auth-switch">
              Already a member? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login') }}>Log in</a>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
