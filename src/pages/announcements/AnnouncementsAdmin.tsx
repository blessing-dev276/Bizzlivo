import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import {
  createAnnouncement,
  deleteAnnouncement,
  loadAdminAnnouncements,
  updateAnnouncement,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementPriority,
} from '../../lib/officeExtras'

interface Opt { id: string; name: string }

export default function AnnouncementsAdmin() {
  const { profile, currentMembership } = useAuth()
  const role = currentMembership?.role
  const orgId = currentMembership?.organization.id

  const [items, setItems] = useState<Announcement[]>([])
  const [teams, setTeams] = useState<Opt[]>([])
  const [ranks, setRanks] = useState<Opt[]>([])
  const [members, setMembers] = useState<Opt[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const [a, t, r, m] = await Promise.all([
      loadAdminAnnouncements(orgId),
      supabase.from('groups').select('id, name').eq('org_id', orgId).order('name'),
      supabase.from('business_path_ranks').select('id, name').eq('org_id', orgId).order('order_index'),
      supabase.from('memberships').select('user_id, profile:profiles(full_name)').eq('org_id', orgId).eq('status', 'active'),
    ])
    setItems(a)
    setTeams((t.data as Opt[]) ?? [])
    setRanks((r.data as Opt[]) ?? [])
    setMembers(((m.data as unknown as { user_id: string; profile: { full_name: string } | null }[]) ?? [])
      .map((x) => ({ id: x.user_id, name: x.profile?.full_name ?? 'Unknown' })))
    setLoading(false)
  }, [orgId])
  useEffect(() => { load() }, [load])

  if (role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="page">
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>Announcements</h1><p>Publish official updates to your office.</p></div>
        <button className="gl-btn" onClick={() => setEditing('new')}>+ New announcement</button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {loading ? (
        <p className="empty-row">Loading…</p>
      ) : items.length === 0 ? (
        <p className="empty-row">No announcements yet.</p>
      ) : (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead><tr><th>Title</th><th>Audience</th><th>Priority</th><th>Published</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>{a.pinned ? '📌 ' : ''}{a.title}</td>
                  <td className="rp-dim">{a.audience_type}</td>
                  <td className="rp-dim">{a.priority}</td>
                  <td className="rp-dim">{new Date(a.publish_at).toLocaleDateString()}</td>
                  <td className="rp-dim">{a.expires_at ? new Date(a.expires_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <button className="gl-btn ghost sm" onClick={() => setEditing(a)}>Edit</button>{' '}
                    <button className="gl-btn ghost sm danger" onClick={async () => { if (confirm(`Delete "${a.title}"?`)) { await deleteAnnouncement(a.id); load() } }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && orgId && profile && (
        <AnnouncementForm
          orgId={orgId}
          createdBy={profile.id}
          existing={editing === 'new' ? null : editing}
          teams={teams} ranks={ranks} members={members}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          setError={setError}
        />
      )}
    </div>
  )
}

function AnnouncementForm({
  orgId, createdBy, existing, teams, ranks, members, onClose, onSaved, setError,
}: {
  orgId: string; createdBy: string; existing: Announcement | null
  teams: Opt[]; ranks: Opt[]; members: Opt[]
  onClose: () => void; onSaved: () => void; setError: (e: string | null) => void
}) {
  const [f, setF] = useState({
    title: existing?.title ?? '',
    body: existing?.body ?? '',
    audience_type: (existing?.audience_type ?? 'all') as AnnouncementAudience,
    audience_ids: existing?.audience_ids ?? [] as string[],
    priority: (existing?.priority ?? 'normal') as AnnouncementPriority,
    link: existing?.link ?? '',
    expires_at: existing?.expires_at ? existing.expires_at.slice(0, 10) : '',
    pinned: existing?.pinned ?? false,
    requires_ack: existing?.requires_ack ?? false,
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))

  const audienceOptions = f.audience_type === 'team' ? teams : f.audience_type === 'rank' ? ranks : f.audience_type === 'members' ? members : []

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!f.title.trim() || !f.body.trim()) return
    setBusy(true); setError(null)
    const payload = {
      title: f.title.trim(), body: f.body.trim(),
      audience_type: f.audience_type,
      audience_ids: f.audience_type === 'all' ? [] : f.audience_ids,
      priority: f.priority, link: f.link.trim() || null,
      expires_at: f.expires_at ? new Date(f.expires_at).toISOString() : null,
      pinned: f.pinned, requires_ack: f.requires_ack,
    }
    const { error } = existing
      ? await updateAnnouncement(existing.id, payload)
      : await createAnnouncement({ org_id: orgId, created_by: createdBy, ...payload })
    setBusy(false)
    if (error) setError(error.message)
    else onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gl-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <form onSubmit={save}>
          <h2>{existing ? 'Edit announcement' : 'New announcement'}</h2>
          <label>Title<input value={f.title} onChange={(e) => set('title', e.target.value)} required autoFocus /></label>
          <label>Message<textarea rows={4} value={f.body} onChange={(e) => set('body', e.target.value)} required /></label>
          <div className="gl-form-row">
            <label>Audience
              <select value={f.audience_type} onChange={(e) => { set('audience_type', e.target.value as AnnouncementAudience); set('audience_ids', []) }}>
                <option value="all">Everyone</option>
                <option value="team">Specific team</option>
                <option value="rank">Specific rank</option>
                <option value="members">Specific members</option>
              </select>
            </label>
            <label>Priority
              <select value={f.priority} onChange={(e) => set('priority', e.target.value as AnnouncementPriority)}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">Important</option>
              </select>
            </label>
          </div>
          {f.audience_type !== 'all' && (
            <label>Recipients
              <select multiple value={f.audience_ids} onChange={(e) => set('audience_ids', Array.from(e.target.selectedOptions).map((o) => o.value))} style={{ minHeight: 96 }}>
                {audienceOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          )}
          <label>Link (optional)<input value={f.link} onChange={(e) => set('link', e.target.value)} placeholder="/events/... or https://" /></label>
          <div className="gl-form-row">
            <label>Expires<input type="date" value={f.expires_at} onChange={(e) => set('expires_at', e.target.value)} /></label>
            <label className="ns-inline"><input type="checkbox" checked={f.pinned} onChange={(e) => set('pinned', e.target.checked)} /> Pinned</label>
            <label className="ns-inline"><input type="checkbox" checked={f.requires_ack} onChange={(e) => set('requires_ack', e.target.checked)} /> Requires acknowledgement</label>
          </div>
          <div className="gl-drawer-actions" style={{ marginTop: 12 }}>
            <button type="submit" className="gl-btn" disabled={busy || !f.title.trim() || !f.body.trim()}>{busy ? 'Saving…' : existing ? 'Save' : 'Publish'}</button>
            <button type="button" className="gl-btn ghost" onClick={onClose}>Cancel</button>
          </div>
          {!existing && <p className="gl-sub-note">Publishing sends a notification to everyone in the audience.</p>}
        </form>
      </div>
    </div>
  )
}
