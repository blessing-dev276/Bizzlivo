import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

// "Leave this office" is for every member. "Delete this office" is admin-only
// and is a soft delete — the platform can bring the office back later with no
// notice to the office. Both live at the bottom of Settings.
export default function MembershipDanger() {
  const { currentMembership, refresh, signOut, memberships } = useAuth()
  const navigate = useNavigate()
  const org = currentMembership?.organization
  const isAdmin = currentMembership?.role === 'admin'

  const [mode, setMode] = useState<null | 'leave' | 'delete'>(null)
  const [confirmName, setConfirmName] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!org || !currentMembership) return null

  async function doLeave() {
    if (!org) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('member_leave_office', { p_org: org.id })
    if (err) {
      setError(err.message)
      setBusy(false)
      return
    }
    const goElsewhere = memberships.some((m) => m.org_id !== org.id)
    await refresh()
    if (goElsewhere) navigate('/')
    else await signOut()
  }

  async function doDelete() {
    if (!org) return
    if (confirmName.trim() !== org.name) {
      setError(`Type the office name exactly to confirm: ${org.name}`)
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('delete_office', { p_org: org.id, p_reason: reason.trim() })
    if (err) {
      setError(err.message)
      setBusy(false)
      return
    }
    await refresh()
    navigate('/')
  }

  return (
    <section className="set-card" style={{ borderColor: 'var(--danger, #dc2626)', marginTop: 32 }}>
      <div className="set-card-head">
        <h2 style={{ color: 'var(--danger, #dc2626)' }}>Danger zone</h2>
        <p>Leaving removes your access to this office. {isAdmin ? 'Deleting closes it for everyone.' : ''}</p>
      </div>

      {error && <p className="form-error">{error}</p>}

      {/* ---- Leave ---- */}
      <div className="set-danger-row">
        <div>
          <strong>Leave this office</strong>
          <span className="set-hint">
            You lose access to {org.name}. An admin can invite you back later.
          </span>
        </div>
        {mode === 'leave' ? (
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={doLeave} disabled={busy}>
              {busy ? 'Leaving…' : 'Confirm leave'}
            </button>
          </span>
        ) : (
          <button type="button" className="btn-danger" onClick={() => { setMode('leave'); setError(null) }}>
            Leave office
          </button>
        )}
      </div>

      {/* ---- Delete (admin only) ---- */}
      {isAdmin && (
        <div className="set-danger-row" style={{ marginTop: 16 }}>
          <div>
            <strong>Delete this office</strong>
            <span className="set-hint">
              Closes {org.name} for every member. Data is retained and the office can be restored by support.
            </span>
            {mode === 'delete' && (
              <div className="set-field-col" style={{ marginTop: 10, gap: 8 }}>
                <label>
                  Type the office name to confirm
                  <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={org.name} />
                </label>
                <label>
                  Reason
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you closing this office?" />
                </label>
              </div>
            )}
          </div>
          {mode === 'delete' ? (
            <span style={{ display: 'flex', gap: 8, alignSelf: 'flex-start' }}>
              <button type="button" className="btn-ghost" onClick={() => setMode(null)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={doDelete}
                disabled={busy || !reason.trim() || confirmName.trim() !== org.name}
              >
                {busy ? 'Deleting…' : 'Delete office'}
              </button>
            </span>
          ) : (
            <button type="button" className="btn-danger" onClick={() => { setMode('delete'); setError(null) }}>
              Delete office
            </button>
          )}
        </div>
      )}
    </section>
  )
}
