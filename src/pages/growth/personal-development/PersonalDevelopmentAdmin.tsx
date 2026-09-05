import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import { localDateString } from '../../../lib/date'
import { createResource } from '../../../lib/createResource'
import { KIND_ICON, KIND_LABEL } from '../../../lib/resourceKind'
import type { PersonalDevelopmentResource, Resource, ResourceKind } from '../../../types/database'

const GROUP_TITLE: Partial<Record<ResourceKind, string>> = { pdf: 'Books', podcast: 'Podcasts', video: 'Videos' }
const GROUP_ORDER: ResourceKind[] = ['pdf', 'podcast', 'video']

interface LinkedRow extends PersonalDevelopmentResource {
  resource: Resource
}

interface MemberRow {
  userId: string
  fullName: string
  doneToday: number
}

function groupByKind(resources: Resource[]): Map<ResourceKind, Resource[]> {
  const map = new Map<ResourceKind, Resource[]>(GROUP_ORDER.map((k) => [k, []]))
  for (const r of resources) map.get(r.file_type as ResourceKind)?.push(r)
  return map
}

export default function PersonalDevelopmentAdmin() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [linked, setLinked] = useState<LinkedRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [membersLoading, setMembersLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [kind, setKind] = useState<ResourceKind>('pdf')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [adding, setAdding] = useState(false)

  async function load(org: string) {
    setLoading(true)
    // Only resources uploaded *for* Personal Development — Skill Set and
    // Freelancing resources live in the same table but are tagged for
    // their own pillars, so they never show up here (0025_resource_purpose.sql).
    const [{ data: linkData }, { data: bookResources }] = await Promise.all([
      supabase.from('personal_development_resources').select('*').eq('org_id', org),
      supabase.from('resources').select('*').eq('org_id', org).eq('purpose', 'book'),
    ])
    const bookById = new Map(((bookResources as Resource[]) ?? []).map((r) => [r.id, r]))
    const rows: LinkedRow[] = ((linkData as PersonalDevelopmentResource[]) ?? []).flatMap((l) => {
      const resource = bookById.get(l.resource_id)
      return resource ? [{ ...l, resource }] : []
    })
    setLinked(rows)
    setLoading(false)
  }

  async function loadMembers(org: string) {
    setMembersLoading(true)
    const todayStr = localDateString()
    const [membershipsRes, completionsRes] = await Promise.all([
      supabase.from('memberships').select('user_id, profile:profiles(full_name)').eq('org_id', org).eq('status', 'active'),
      supabase.from('personal_development_completions').select('user_id, resource_id').eq('org_id', org).eq('completed_on', todayStr),
    ])
    const doneByUser = new Map<string, Set<string>>()
    for (const c of (completionsRes.data as { user_id: string; resource_id: string }[]) ?? []) {
      if (!doneByUser.has(c.user_id)) doneByUser.set(c.user_id, new Set())
      doneByUser.get(c.user_id)!.add(c.resource_id)
    }
    const rows: MemberRow[] = ((membershipsRes.data as unknown as { user_id: string; profile: { full_name: string } | null }[]) ?? []).map((m) => ({
      userId: m.user_id,
      fullName: m.profile?.full_name ?? 'Unknown',
      doneToday: doneByUser.get(m.user_id)?.size ?? 0,
    }))
    setMembers(rows)
    setMembersLoading(false)
  }

  useEffect(() => {
    if (!orgId) return
    load(orgId)
    loadMembers(orgId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function addResource(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !title.trim()) return
    setError(null)
    setAdding(true)
    try {
      const resource = await createResource({ orgId, uploadedBy: profile.id, title: title.trim(), kind, purpose: 'book', file, linkUrl })
      const { error: linkError } = await supabase
        .from('personal_development_resources')
        .insert({ org_id: orgId, resource_id: resource.id, added_by: profile.id })
      if (linkError) throw new Error(linkError.message)

      setTitle('')
      setFile(null)
      setLinkUrl('')
      await load(orgId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this resource.')
    } finally {
      setAdding(false)
    }
  }

  async function removeResource(link: LinkedRow) {
    if (!orgId) return
    setError(null)
    setBusyId(link.id)
    const { error: deleteErr } = await supabase.from('personal_development_resources').delete().eq('id', link.id)
    setBusyId(null)
    if (deleteErr) setError(deleteErr.message)
    else await load(orgId)
  }

  if (loading) return <p>Loading…</p>

  const linkedByKind = groupByKind(linked.map((l) => l.resource))
  const totalRequired = linked.length

  return (
    <div>
      <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
        Add the books, podcasts, and videos every member should get through each day — how they're meant to be used
        is up to you. These are separate from your Skill Set and Freelancing resources.
      </p>
      {error && <p className="form-error">{error}</p>}

      <h4 className="overview-heading">REQUIRED DAILY RESOURCES ({linked.length})</h4>
      {linked.length === 0 ? (
        <p className="empty-row">Nothing required yet — add one below.</p>
      ) : (
        GROUP_ORDER.map((k) => {
          const items = linkedByKind.get(k) ?? []
          if (items.length === 0) return null
          const linkForResource = (resourceId: string) => linked.find((l) => l.resource_id === resourceId)!
          return (
            <div key={k} style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-faint)', marginBottom: 8 }}>{GROUP_TITLE[k]}</p>
              {items.map((r) => {
                const link = linkForResource(r.id)
                return (
                  <div className="res-card" key={r.id} style={{ marginBottom: 8 }}>
                    <div className="res-top">
                      <div className="res-left">
                        <div className="res-icon">{KIND_ICON[k]}</div>
                        <div className="res-title-block"><h3>{r.title}</h3></div>
                      </div>
                      <button type="button" className="secondary" onClick={() => removeResource(link)} disabled={busyId === link.id}>
                        Remove
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })
      )}

      <h4 className="overview-heading" style={{ marginTop: 28 }}>ADD A RESOURCE</h4>
      <form onSubmit={addResource} className="upload-panel">
        <div className="cycle-toggle" style={{ marginBottom: 18 }}>
          {GROUP_ORDER.map((k) => (
            <button key={k} type="button" className={kind === k ? 'active' : ''} onClick={() => { setKind(k); setFile(null); setLinkUrl(''); setError(null) }}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="upload-grid">
          <label>
            Title
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Atomic Habits" />
          </label>
          {kind === 'pdf' ? (
            <label key="file">
              PDF file
              <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          ) : (
            <label key="link">
              {kind === 'podcast' ? 'Podcast link' : 'Video link'}
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder={kind === 'podcast' ? 'https://open.spotify.com/…' : 'https://youtube.com/…'}
              />
            </label>
          )}
        </div>
        <div className="upload-actions">
          <button type="submit" disabled={adding || !title.trim() || (kind === 'pdf' ? !file : !linkUrl.trim())}>
            {adding ? 'Adding…' : 'Add resource'}
          </button>
        </div>
      </form>

      <h4 className="overview-heading" style={{ marginTop: 32 }}>TODAY'S PROGRESS</h4>
      {membersLoading ? (
        <p className="empty-row">Loading…</p>
      ) : members.length === 0 ? (
        <p className="empty-row">No members yet.</p>
      ) : totalRequired === 0 ? (
        <p className="empty-row">Add required resources above to start tracking progress.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Done today</th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td>{m.fullName}</td>
                  <td>{m.doneToday} of {totalRequired}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
