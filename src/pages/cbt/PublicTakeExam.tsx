import { useCallback, useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import ThemeToggle from '../../components/ThemeToggle'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function callFunction(name: string, init?: RequestInit) {
  const res = await fetch(`${FUNCTIONS_URL}${name}`, {
    ...init,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'Something went wrong.')
  return body
}

interface PublicOption {
  id: string
  text: string
}
interface PublicQuestion {
  id: string
  text: string
  type: string
  options: PublicOption[]
}
interface StartResponse {
  attempt_id: string
  org_id: string
  exam_title: string
  office_name: string | null
  time_limit_minutes: number
  started_at: string
  questions: PublicQuestion[]
}
interface SubmitResponse {
  score_percent: number
  passed: boolean
  correct_count: number
  total: number
}

type Stage = 'loading' | 'auth' | 'taking' | 'result' | 'error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function PublicTakeExam() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { session, refresh, setCurrentOrgId } = useAuth()

  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState<string | null>(null)
  const [examTitle, setExamTitle] = useState('')
  const [officeName, setOfficeName] = useState<string | null>(null)
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(0)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [hasAccount, setHasAccount] = useState<boolean | null>(null)
  const [checkingAccount, setCheckingAccount] = useState(false)
  const [authenticating, setAuthenticating] = useState(false)

  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<PublicQuestion[]>([])
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [result, setResult] = useState<SubmitResponse | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    callFunction(`start-attempt?token=${encodeURIComponent(token)}`)
      .then((data: { exam_title: string; office_name: string | null; time_limit_minutes: number }) => {
        if (cancelled) return
        setExamTitle(data.exam_title)
        setOfficeName(data.office_name)
        setTimeLimitMinutes(data.time_limit_minutes)
        setStage('auth')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'This exam link is not available.')
        setStage('error')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function checkAccount(e: FocusEvent<HTMLInputElement>) {
    const value = e.target.value.trim()
    if (!token || !EMAIL_RE.test(value)) return
    setCheckingAccount(true)
    try {
      const data: { hasAccount: boolean } = await callFunction(
        `check-exam-link-account?token=${encodeURIComponent(token)}&email=${encodeURIComponent(value)}`
      )
      setHasAccount(data.hasAccount)
    } catch {
      // Non-fatal — the taker can still use the manual "log in / sign up
      // instead" switch below if this lookup didn't resolve.
    } finally {
      setCheckingAccount(false)
    }
  }

  async function startAttemptWithSession(accessToken: string) {
    const data: StartResponse = await callFunction('start-attempt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ token, name: name.trim() || undefined, whatsapp: whatsapp.trim() || undefined }),
    })
    setAttemptId(data.attempt_id)
    setQuestions(data.questions)
    const deadline = new Date(data.started_at).getTime() + data.time_limit_minutes * 60 * 1000
    setRemainingSeconds(Math.max(0, Math.round((deadline - Date.now()) / 1000)))
    await refresh()
    setCurrentOrgId(data.org_id)
    setStage('taking')
  }

  // A visitor who's already logged in (e.g. an office member clicking their
  // own exam link) skips the signup/login gate entirely.
  useEffect(() => {
    if (stage !== 'auth' || !session) return
    setAuthenticating(true)
    setError(null)
    startAttemptWithSession(session.access_token).catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not start the exam.')
      setAuthenticating(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, session])

  async function handleStart(e: FormEvent) {
    e.preventDefault()
    if (!token || !email.trim() || !password) return
    setAuthenticating(true)
    setError(null)
    try {
      let accessToken: string

      if (hasAccount) {
        const { data, error: loginError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (loginError) throw loginError
        accessToken = data.session.access_token
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        })
        if (signUpError) {
          if (/already registered|already exists/i.test(signUpError.message)) {
            setHasAccount(true)
            setError('This email already has an account — log in below.')
            return
          }
          throw signUpError
        }
        if (!data.user) throw new Error('Sign up did not return a user. Please try again.')

        if (!data.session) {
          // Registering by starting this exam is itself proof of intent to
          // use this exact email, so skip Supabase's separate confirmation
          // email — confirm server-side, then sign in immediately.
          await callFunction('confirm-exam-signup', {
            method: 'POST',
            body: JSON.stringify({ token, userId: data.user.id }),
          })
          const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          })
          if (loginError) throw loginError
          accessToken = loginData.session.access_token
        } else {
          accessToken = data.session.access_token
        }
      }

      await startAttemptWithSession(accessToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the exam.')
    } finally {
      setAuthenticating(false)
    }
  }

  const submit = useCallback(async () => {
    if (submittingRef.current || !attemptId) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const answers = questions.map((q) => ({
        question_id: q.id,
        selected_option_ids: selections[q.id] ?? [],
      }))
      const data: SubmitResponse = await callFunction('submit-attempt', {
        method: 'POST',
        body: JSON.stringify({ attempt_id: attemptId, answers }),
      })
      setResult(data)
      setStage('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the exam.')
    } finally {
      setSubmitting(false)
    }
  }, [attemptId, questions, selections])

  useEffect(() => {
    if (stage !== 'taking') return
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          submit()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [stage, submit])

  function selectOption(questionId: string, optionId: string) {
    setSelections((prev) => ({ ...prev, [questionId]: [optionId] }))
  }

  const answeredCount = questions.filter((q) => (selections[q.id]?.length ?? 0) > 0).length
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60

  return (
    <div className="auth-page" style={{ alignItems: stage === 'taking' ? 'flex-start' : 'center' }}>
      <div className="blob blob-a" />
      <div className="blob blob-b" />
      <div className="auth-theme-toggle">
        <ThemeToggle />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: stage === 'taking' || stage === 'result' ? 640 : 380, margin: stage === 'taking' ? '40px 0' : 0 }}>
        {officeName ? (
          <div className="auth-logo" style={{ flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 22 }}>{officeName}</span>
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              powered by HQ360
            </span>
          </div>
        ) : (
          <div className="auth-logo">
            <span className="logo-mark">H</span>
            HQ<span>360</span>
          </div>
        )}

        {(stage === 'loading' || (stage === 'auth' && session)) && (
          <div className="auth-card">
            <p>{stage === 'auth' ? 'Starting your exam…' : 'Loading exam…'}</p>
            {error && <p className="form-error">{error}</p>}
          </div>
        )}

        {stage === 'error' && (
          <div className="auth-card">
            <h1>Link unavailable</h1>
            <p className="form-error">{error}</p>
          </div>
        )}

        {stage === 'auth' && !session && (
          <form className="auth-card" onSubmit={handleStart}>
            <h1>{examTitle}</h1>
            <p className="auth-subtitle">
              {timeLimitMinutes} minute{timeLimitMinutes === 1 ? '' : 's'} · Starting registers you with{' '}
              {officeName ?? 'this office'}
            </p>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setHasAccount(null)
                }}
                onBlur={checkAccount}
                required
                autoFocus
                placeholder="ada@email.com"
              />
            </label>

            {hasAccount === null && email.trim() && (
              <p style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: -8 }}>
                {checkingAccount ? 'Checking…' : ' '}
              </p>
            )}

            {hasAccount === false && (
              <label>
                Your name
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Ada Obi" />
              </label>
            )}

            {hasAccount !== null && (
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete={hasAccount ? 'current-password' : 'new-password'}
                />
              </label>
            )}

            {hasAccount === false && (
              <label>
                WhatsApp number
                <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="e.g. 08012345678" />
              </label>
            )}

            {error && <p className="form-error">{error}</p>}

            <button type="submit" disabled={authenticating || hasAccount === null}>
              {authenticating
                ? 'Starting…'
                : hasAccount === null
                  ? 'Enter your email to continue'
                  : hasAccount
                    ? 'Log in & start exam'
                    : 'Sign up & start exam'}
            </button>

            {hasAccount !== null && (
              <p className="auth-switch">
                {hasAccount ? (
                  <>New here? <a onClick={() => setHasAccount(false)} href="#">Sign up instead</a></>
                ) : (
                  <>Already registered? <a onClick={() => setHasAccount(true)} href="#">Log in instead</a></>
                )}
              </p>
            )}
          </form>
        )}

        {stage === 'taking' && (
          <div>
            <div className="list-header">
              <h1>{examTitle}</h1>
              <span className={`timer ${remainingSeconds < 60 ? 'low' : ''}`}>
                {minutes}:{seconds.toString().padStart(2, '0')}
              </span>
            </div>
            <p style={{ color: 'var(--text-dim)' }}>{answeredCount} of {questions.length} answered</p>

            {questions.map((q, idx) => (
              <div className="exam-question" key={q.id}>
                <h2>{idx + 1}. {q.text}</h2>
                {q.options.map((opt) => (
                  <div
                    key={opt.id}
                    className={`exam-option ${(selections[q.id] ?? []).includes(opt.id) ? 'selected' : ''}`}
                    onClick={() => selectOption(q.id, opt.id)}
                  >
                    <input type="radio" checked={(selections[q.id] ?? []).includes(opt.id)} readOnly />
                    {opt.text}
                  </div>
                ))}
              </div>
            ))}

            {error && <p className="form-error">{error}</p>}
            <button onClick={submit} disabled={submitting}>
              {submitting ? 'Submitting…' : answeredCount < questions.length ? `Submit (${questions.length - answeredCount} unanswered)` : 'Submit'}
            </button>
          </div>
        )}

        {stage === 'result' && result && (
          <div className="result-hero">
            <p>{examTitle}</p>
            <div className={`result-score ${result.passed ? 'result-pass' : 'result-fail'}`}>{result.score_percent}%</div>
            <h2 className={result.passed ? 'result-pass' : 'result-fail'}>{result.passed ? 'Passed' : 'Failed'}</h2>
            <p>{result.correct_count} of {result.total} correct</p>
            <button onClick={() => navigate('/')} style={{ marginTop: 16 }}>
              Go to your dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
