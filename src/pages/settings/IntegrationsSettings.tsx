import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

interface IntegrationStatus {
  status: 'connected' | 'attention' | 'disconnected'
  google_account_email: string | null
  calendar_id: string
  last_sync_at: string | null
  last_error: string | null
}

const CALLBACK_MSG: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  connected: { kind: 'ok', text: 'Google account connected.' },
  denied: { kind: 'err', text: 'Google connection was cancelled.' },
  expired: { kind: 'err', text: 'That connection link expired — try again.' },
  no_refresh: { kind: 'err', text: 'Google didn’t return a refresh token. Remove Bizzlivo from your Google account’s third-party access, then reconnect.' },
  not_configured: { kind: 'err', text: 'Google integration isn’t configured on this deployment yet.' },
  error: { kind: 'err', text: 'Something went wrong connecting Google. Try again.' },
}

export default function IntegrationsSettings() {
  const { currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const isAdmin = currentMembership?.role === 'admin'

  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()

  const load = useCallback(async () => {
    if (!orgId) return
    const { data } = await supabase.rpc('get_org_integration', { p_org: orgId })
    const row = (data as IntegrationStatus[] | null)?.[0] ?? null
    setStatus(row ?? { status: 'disconnected', google_account_email: null, calendar_id: 'primary', last_sync_at: null, last_error: null })
    setLoading(false)
  }, [orgId])

  useEffect(() => { setLoading(true); load() }, [load])

  const callback = params.get('google')
  useEffect(() => {
    if (callback) {
      // clear the query param after reading it
      const p = new URLSearchParams(params); p.delete('google'); setParams(p, { replace: true })
      load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callback])

  async function connect() {
    if (!orgId) return
    setBusy(true); setErr(null)
    const { data, error } = await supabase.functions.invoke('google-oauth-start', { body: { orgId } })
    setBusy(false)
    if (error || data?.error) { setErr(data?.message ?? data?.error ?? error?.message ?? 'Could not start Google connect.'); return }
    if (data?.url) window.location.href = data.url
  }

  async function disconnect() {
    if (!orgId || !confirm('Disconnect the office Google account? Existing events and their history are kept; future Google sync stops until you reconnect.')) return
    setBusy(true); setErr(null)
    const { data, error } = await supabase.functions.invoke('google-disconnect', { body: { orgId } })
    setBusy(false)
    if (error || data?.error) { setErr(data?.error ?? error?.message ?? 'Could not disconnect.'); return }
    await load()
  }

  if (!isAdmin) {
    return <div className="page-head"><h1>Integrations</h1><p>Only your office's admin can manage integrations.</p></div>
  }
  if (loading) return <p className="empty-row">Loading…</p>

  const cb = callback ? CALLBACK_MSG[callback] : null

  return (
    <div>
      <div className="page-head">
        <h1>Integrations</h1>
        <p>Connect an official office Google account so online events can create and sync Google Calendar entries and Meet links automatically.</p>
      </div>

      {cb && <p className={cb.kind === 'ok' ? 'form-info' : 'form-error'}>{cb.text}</p>}
      {err && <p className="form-error">{err}</p>}

      <section className="set-card" style={{ maxWidth: 560 }}>
        <div className="set-card-head">
          <h2>Google Calendar &amp; Meet</h2>
          <p>The connected account is the meeting organizer. Members just click “Join Google Meet” — they never connect their own Google.</p>
        </div>

        {status?.status === 'connected' ? (
          <>
            <dl className="bp-facts">
              <div><dt>Google account</dt><dd>{status.google_account_email ?? '—'}</dd></div>
              <div><dt>Calendar</dt><dd>{status.calendar_id === 'primary' ? 'Primary' : status.calendar_id}</dd></div>
              <div><dt>Status</dt><dd><span className="badge active">Connected</span></dd></div>
              {status.last_sync_at && <div><dt>Last sync</dt><dd>{new Date(status.last_sync_at).toLocaleString()}</dd></div>}
            </dl>
            <button type="button" className="secondary" disabled={busy} onClick={disconnect}>Disconnect</button>
          </>
        ) : status?.status === 'attention' ? (
          <>
            <p className="form-error">Integration attention required — Google access needs reconnecting. {status.last_error}</p>
            <button type="button" disabled={busy} onClick={connect}>Reconnect Google</button>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--text-dim)', fontSize: 13.5 }}>Status: <strong>Not connected</strong>. Google Meet events save without a link until you connect; external-link and physical events are unaffected.</p>
            <button type="button" disabled={busy} onClick={connect}>Connect Google</button>
          </>
        )}
      </section>
    </div>
  )
}
