import BrandLogo from '../../components/BrandLogo'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { requestOfficeSignup } from '../../lib/completeSignup'
import ThemeToggle from '../../components/ThemeToggle'

export default function Signup() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [officeName, setOfficeName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Once the confirmation email is on its way we swap the form for a
  // "check your inbox" panel — the office is created on first login
  // after the user confirms.
  const [sent, setSent] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendNote, setResendNote] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const result = await requestOfficeSignup({ fullName, officeName, email, password })
    setSubmitting(false)

    if (result.ok) {
      setSent(true)
      return
    }
    if (result.code === 'already_confirmed') {
      navigate('/login', {
        state: { message: 'This email is already confirmed — log in to continue.' },
      })
      return
    }
    setError(result.error)
  }

  async function handleResend() {
    setResending(true)
    setResendNote(null)
    const result = await requestOfficeSignup({ fullName, officeName, email, password })
    setResending(false)
    setResendNote(
      result.ok
        ? `We've sent another confirmation email to ${email}.`
        : result.error,
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
        <div className="auth-logo">
          <BrandLogo size={30} tagline />
        </div>

        {sent ? (
          <div className="auth-card">
            <h1>Confirm your email</h1>
            <p className="auth-subtitle">
              We've sent a confirmation link to <strong>{email}</strong>. Open it to activate
              your account, then log in to finish setting up <strong>{officeName}</strong>.
            </p>
            <p className="form-info" style={{ marginBottom: 16 }}>
              Can't find it? Check your spam folder — the email is from Bizzlivo.
            </p>

            {resendNote && <p className="form-info">{resendNote}</p>}

            <button type="button" onClick={handleResend} disabled={resending}>
              {resending ? 'Sending…' : 'Resend confirmation email'}
            </button>

            <p className="auth-switch">
              Already confirmed? <Link to="/login">Log in</Link>
            </p>
          </div>
        ) : (
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
              <span className="pw-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>

            {error && <p className="form-error">{error}</p>}

            <button type="submit" disabled={submitting}>
              {submitting ? 'Creating your office…' : 'Create office'}
            </button>

            <p className="auth-switch">
              Already have an account? <Link to="/login">Log in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
