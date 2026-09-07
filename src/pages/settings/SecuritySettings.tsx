import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

// Account & Security. Only exposes what Supabase Auth actually supports —
// change email (with confirmation), change password, and revoke other
// sessions. A full session list / security-event log is not available
// from the client, so it isn't faked here.
export default function SecuritySettings() {
  const { session } = useAuth()
  const currentEmail = session?.user?.email ?? ''

  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function changeEmail(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ email: email.trim() })
    setBusy(false)
    setMsg(error ? { kind: 'err', text: error.message } : { kind: 'ok', text: `Confirmation sent to ${email.trim()}. Both addresses must confirm.` })
    if (!error) setEmail('')
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) { setMsg({ kind: 'err', text: 'Use at least 8 characters.' }); return }
    if (pw !== pw2) { setMsg({ kind: 'err', text: 'Passwords don’t match.' }); return }
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    setMsg(error ? { kind: 'err', text: error.message } : { kind: 'ok', text: 'Password updated.' })
    if (!error) { setPw(''); setPw2('') }
  }

  async function signOutOthers() {
    if (!confirm('Sign out of every other device? This session stays active.')) return
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    setBusy(false)
    setMsg(error ? { kind: 'err', text: error.message } : { kind: 'ok', text: 'All other sessions signed out.' })
  }

  return (
    <div>
      <div className="page-head">
        <h1>Account &amp; Security</h1>
        <p>Manage how you sign in to Bizzlivo.</p>
      </div>

      {msg && <p className={msg.kind === 'ok' ? 'form-info' : 'form-error'}>{msg.text}</p>}

      <div className="sec-block">
        <h3>Email</h3>
        <p className="sec-cur">Current: <strong>{currentEmail}</strong></p>
        <form onSubmit={changeEmail}>
          <label>New email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <button type="submit" className="gl-btn ghost sm" disabled={busy || !email.trim()}>Change email</button>
        </form>
      </div>

      <div className="sec-block">
        <h3>Password</h3>
        <form onSubmit={changePassword}>
          <label>New password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
          <label>Confirm<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></label>
          <button type="submit" className="gl-btn ghost sm" disabled={busy || !pw}>Update password</button>
        </form>
      </div>

      <div className="sec-block">
        <h3>Sessions</h3>
        <p className="sec-cur">You’re signed in on this device. Bizzlivo can’t list your other devices, but you can end them all.</p>
        <button type="button" className="gl-btn ghost sm danger" disabled={busy} onClick={signOutOthers}>Sign out of other devices</button>
      </div>
    </div>
  )
}
