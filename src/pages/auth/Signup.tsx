import BrandLogo from '../../components/BrandLogo'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { completeOfficeSignup } from '../../lib/completeSignup'
import { useAuth } from '../../lib/AuthContext'
import ThemeToggle from '../../components/ThemeToggle'

export default function Signup() {
  const navigate = useNavigate()
  const { refresh, setCurrentOrgId } = useAuth()
  const [fullName, setFullName] = useState('')
  const [officeName, setOfficeName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      // full_name/office_name ride along as user metadata so they survive
      // even if email confirmation defers session creation to a later,
      // separate login — see completeOfficeSignup for why.
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, office_name: officeName } },
      })
      if (signUpError) throw signUpError
      const user = signUpData.user
      if (!user) throw new Error('Sign up did not return a user. Please try again.')

      if (!signUpData.session) {
        setSubmitting(false)
        navigate('/login', {
          state: { message: 'Check your email to confirm your account, then log in to finish setting up your office.' },
        })
        return
      }

      const orgId = await completeOfficeSignup(user)
      await refresh()
      if (orgId) setCurrentOrgId(orgId)
      navigate('/onboarding')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="blob blob-a" />
      <div className="blob blob-b" />
      <div className="auth-theme-toggle">
        <ThemeToggle />
      </div>
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 380 }}>
        <div className="auth-logo">
          <BrandLogo size={30} tagline />
        </div>
        <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Create your office</h1>
        <p className="auth-subtitle">Set up Bizzlivo for your team in a couple of minutes.</p>

        <label>
          Your full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
        </label>

        <label>
          Office name
          <input value={officeName} onChange={(e) => setOfficeName(e.target.value)} required placeholder="e.g. Acme Realty" />
        </label>

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
            minLength={8}
            autoComplete="new-password"
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating your office…' : 'Create office'}
        </button>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
        </form>
      </div>
    </div>
  )
}
