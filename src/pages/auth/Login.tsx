import BrandLogo from '../../components/BrandLogo'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import ThemeToggle from '../../components/ThemeToggle'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const infoMessage = (location.state as { message?: string } | null)?.message
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(signInError.message)
      setSubmitting(false)
      return
    }
    navigate('/')
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
        <h1>Log in</h1>
        {infoMessage && <p className="form-info">{infoMessage}</p>}

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
          Need an office? <Link to="/signup">Create one</Link>
        </p>
        </form>
      </div>
    </div>
  )
}
