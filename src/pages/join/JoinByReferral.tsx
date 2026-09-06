import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

interface Preview {
  orgName: string | null
  orgSlug: string | null
  referrerName: string | null
}

export default function JoinByReferral() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { session, refresh, setCurrentOrgId } = useAuth()

  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'signup' | 'login'>('signup')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!code) return
    fetch(`${FUNCTIONS_URL}/join-by-referral?code=${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error)
        else setPreview(data)
      })
      .catch(() => setError('Could not load this referral link.'))
      .finally(() => setLoading(false))
  }, [code])

  async function joinWithSession(accessToken: string) {
    const res = await fetch(`${FUNCTIONS_URL}/join-by-referral`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ code, fullName }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data as { orgId: string }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault()
    if (!code) return
    setError(null)
    setBusy(true)
    try {
      let accessToken = session?.access_token

      if (!accessToken) {
        if (mode === 'signup') {
          const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
          if (signUpError) throw signUpError
          if (data.session) {
            accessToken = data.session.access_token
          } else {
            const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password })
            if (loginError) throw loginError
            accessToken = loginData.session.access_token
          }
        } else {
          const { data, error: loginError } = await supabase.auth.signInWithPassword({ email, password })
          if (loginError) throw loginError
          accessToken = data.session.access_token
        }
      }

      const { orgId } = await joinWithSession(accessToken!)
      await refresh()
      setCurrentOrgId(orgId)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the join.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="auth-page"><div className="auth-card"><p>Loading…</p></div></div>

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Join {preview?.orgName ?? 'the office'}</h1>
        {preview?.referrerName && (
          <p className="auth-subtitle">You were invited by {preview.referrerName}. They'll be recorded as your sponsor.</p>
        )}
        {error && <p className="form-error">{error}</p>}

        {!error && (
          <form onSubmit={handleJoin}>
            {!session && (
              <div className="auth-switch">
                <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
                  New account
                </button>
                <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
                  I have an account
                </button>
              </div>
            )}

            {!session && mode === 'signup' && (
              <label>Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></label>
            )}
            {!session && (
              <>
                <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
                <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></label>
              </>
            )}

            <button type="submit" disabled={busy} style={{ marginTop: 12 }}>
              {busy ? 'Joining…' : session ? 'Join this office' : mode === 'signup' ? 'Create account & join' : 'Log in & join'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
