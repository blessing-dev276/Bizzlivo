import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

interface InviteInfo {
  orgName: string | null
  email: string | null
  role: string
  expired: boolean
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { session, refresh, setCurrentOrgId } = useAuth()

  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'signup' | 'login'>('signup')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch(`${FUNCTIONS_URL}/accept-invite?token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error)
        else setInvite(data)
      })
      .catch(() => setError('Could not load this invite.'))
      .finally(() => setLoading(false))
  }, [token])

  async function confirmInviteSignup(userId: string) {
    const res = await fetch(`${FUNCTIONS_URL}/confirm-invite-signup`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token, userId }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
  }

  async function acceptWithSession(accessToken: string) {
    const res = await fetch(`${FUNCTIONS_URL}/accept-invite`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token, fullName }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data as { orgId: string }
  }

  async function handleAccept(e: FormEvent) {
    e.preventDefault()
    if (!invite || !token) return
    setError(null)
    setBusy(true)

    try {
      let accessToken = session?.access_token

      if (!accessToken) {
        if (mode === 'signup') {
          const { data, error: signUpError } = await supabase.auth.signUp({
            email: invite.email!,
            password,
          })
          if (signUpError) throw signUpError
          if (!data.user) throw new Error('Sign up did not return a user. Please try again.')

          if (!data.session) {
            // Receiving this invite at their exact email address already proves
            // ownership, so skip Supabase's own separate confirmation email —
            // confirm server-side, then sign in immediately.
            await confirmInviteSignup(data.user.id)
            const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
              email: invite.email!,
              password,
            })
            if (loginError) throw loginError
            accessToken = loginData.session.access_token
          } else {
            accessToken = data.session.access_token
          }
        } else {
          const { data, error: loginError } = await supabase.auth.signInWithPassword({
            email: invite.email!,
            password,
          })
          if (loginError) throw loginError
          accessToken = data.session.access_token
        }
      }

      const { orgId } = await acceptWithSession(accessToken!)
      await refresh()
      setCurrentOrgId(orgId)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invite.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="auth-page"><p>Loading invite…</p></div>

  if (error && !invite) {
    return (
      <div className="auth-page">
        <div className="auth-card"><p className="form-error">{error}</p></div>
      </div>
    )
  }

  if (invite?.expired) {
    return (
      <div className="auth-page">
        <div className="auth-card"><p className="form-error">This invite has expired or was already used.</p></div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleAccept}>
        <h1>Join {invite?.orgName}</h1>
        <p className="auth-subtitle">You've been invited as {invite?.role}.</p>

        {!session && (
          <>
            <label>
              Email
              <input value={invite?.email ?? ''} disabled />
            </label>
            {mode === 'signup' && (
              <label>
                Your full name
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </label>
            )}
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </label>
          </>
        )}

        {error && <p className="form-error">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'Joining…' : session ? 'Accept invite' : mode === 'signup' ? 'Create account & join' : 'Log in & join'}
        </button>

        {!session && (
          <p className="auth-switch">
            {mode === 'signup' ? (
              <>Already have an account? <a onClick={() => setMode('login')} href="#">Log in</a></>
            ) : (
              <>New here? <a onClick={() => setMode('signup')} href="#">Create an account</a></>
            )}
          </p>
        )}
      </form>
    </div>
  )
}
