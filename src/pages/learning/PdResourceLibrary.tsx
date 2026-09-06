import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { createResource } from '../../lib/createResource'
import { KIND_ICON, resourceKind } from '../../lib/resourceKind'
import type { Resource, ResourceKind } from '../../types/database'

const FILTERS: { key: 'all' | ResourceKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pdf', label: 'Books & PDFs' },
  { key: 'podcast', label: 'Podcasts' },
  { key: 'video', label: 'Videos' },
]

export default function PdResourceLibrary({ readOnly = false }: { readOnly?: boolean }) {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | ResourceKind>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [kind, setKind] = useState<ResourceKind>('pdf')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [link, setLink] = useState('')

  const reload = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data: links } = await supabase.from('personal_development_resources').select('resource_id').eq('org_id', orgId)
    const ids = ((links as { resource_id: string }[]) ?? []).map((r) => r.resource_id)
    if (ids.length === 0) { setResources([]); setLoading(false); return }
    const { data } = await supabase.from('resources').select('*').in('id', ids).order('title')
    setResources((data as Resource[]) ?? [])
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const resource = await createResource({
        orgId, uploadedBy: profile.id, title: title.trim(), kind, purpose: 'book',
        file: kind === 'pdf' ? file : null, linkUrl: kind === 'pdf' ? null : link,
      })
      const { error: e1 } = await supabase.from('personal_development_resources').insert({ org_id: orgId, resource_id: resource.id, added_by: profile.id })
      if (e1) throw new Error(e1.message)
      setTitle('')
      setFile(null)
      setLink('')
      setShowAdd(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this resource.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(r: Resource) {
    if (!orgId || !confirm(`Remove "${r.title}" from the library? The resource itself is kept.`)) return
    setBusy(true)
    await supabase.from('personal_development_resources').delete().eq('org_id', orgId).eq('resource_id', r.id)
    setBusy(false)
    await reload()
  }

  if (loading) return <p className="md-muted">Loading…</p>
  const visible = filter === 'all' ? resources : resources.filter((r) => resourceKind(r) === filter)

  return (
    <div>
      <div className="list-head">
        <h2>Personal Development library</h2>
        {!readOnly && <button type="button" onClick={() => setShowAdd(true)}>+ Add Resource</button>}
      </div>

      <div className="chips" style={{ marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}

      {visible.length === 0 ? (
        <p className="empty-row">Nothing here yet.</p>
      ) : (
        visible.map((r) => (
          <div className="res-card" key={r.id} style={{ marginBottom: 8 }}>
            <div className="res-top">
              <div className="res-left">
                <div className="res-icon">{KIND_ICON[resourceKind(r)]}</div>
                <div className="res-title-block">
                  <h3>{r.title}</h3>
                  <span className="badge">{resourceKind(r) === 'pdf' ? 'Book / PDF' : resourceKind(r) === 'podcast' ? 'Podcast' : 'Video'}</span>
                </div>
              </div>
              {!readOnly && <button type="button" className="btn-ghost" onClick={() => remove(r)}>Remove</button>}
            </div>
          </div>
        ))
      )}

      {showAdd && !readOnly && (
        <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={add}>
              <h2>Add resource</h2>
              <label>
                Type
                <select value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)}>
                  <option value="pdf">Book / PDF (upload)</option>
                  <option value="podcast">Podcast (link)</option>
                  <option value="video">Video (link)</option>
                </select>
              </label>
              <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus /></label>
              {kind === 'pdf' ? (
                <label>PDF file<input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
              ) : (
                <label>Link<input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" /></label>
              )}
              {error && <p className="form-error">{error}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy || !title.trim()}>{busy ? 'Adding…' : 'Add'}</button>
                <button type="button" className="secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
