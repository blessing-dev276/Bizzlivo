import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import type { Exam, NetworkMarketingProduct, Resource } from '../../types/database'

interface Form {
  name: string
  description: string
  link_url: string
  video_resource_id: string
  pdf_resource_id: string
  exam_id: string
  is_active: boolean
}
const BLANK: Form = { name: '', description: '', link_url: '', video_resource_id: '', pdf_resource_id: '', exam_id: '', is_active: true }

export default function ProductsCatalog({ readOnly = false }: { readOnly?: boolean }) {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [products, setProducts] = useState<NetworkMarketingProduct[]>([])
  const [videos, setVideos] = useState<Resource[]>([])
  const [pdfs, setPdfs] = useState<Resource[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<NetworkMarketingProduct | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Form>(BLANK)

  const reload = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const [p, r, x] = await Promise.all([
      supabase.from('network_marketing_products').select('*').eq('org_id', orgId).order('order_index', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('resources').select('*').eq('org_id', orgId).order('title'),
      supabase.from('exams').select('*').eq('org_id', orgId).eq('status', 'published').order('title'),
    ])
    setProducts((p.data as NetworkMarketingProduct[]) ?? [])
    const res = (r.data as Resource[]) ?? []
    setVideos(res.filter((rr) => rr.file_type === 'video'))
    setPdfs(res.filter((rr) => rr.file_type === 'pdf'))
    setExams((x.data as Exam[]) ?? [])
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  function openAdd() {
    setEditing(null)
    setForm(BLANK)
    setError(null)
    setShowForm(true)
  }
  function openEdit(p: NetworkMarketingProduct) {
    setEditing(p)
    setForm({
      name: p.name,
      description: p.description ?? '',
      link_url: p.link_url ?? '',
      video_resource_id: p.video_resource_id ?? '',
      pdf_resource_id: p.pdf_resource_id ?? '',
      exam_id: p.exam_id ?? '',
      is_active: p.is_active,
    })
    setError(null)
    setShowForm(true)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !form.name.trim()) return
    setBusy(true)
    setError(null)
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      link_url: form.link_url.trim() || null,
      video_resource_id: form.video_resource_id || null,
      pdf_resource_id: form.pdf_resource_id || null,
      exam_id: form.exam_id || null,
      is_active: form.is_active,
    }
    const { error: e1 } = editing
      ? await supabase.from('network_marketing_products').update(payload).eq('id', editing.id)
      : await supabase.from('network_marketing_products').insert({ ...payload, org_id: orgId, added_by: profile.id, order_index: products.length })
    setBusy(false)
    if (e1) { setError(e1.message); return }
    setShowForm(false)
    await reload()
  }

  async function move(p: NetworkMarketingProduct, dir: -1 | 1) {
    const sorted = [...products].sort((a, b) => a.order_index - b.order_index)
    const idx = sorted.findIndex((x) => x.id === p.id)
    const swap = sorted[idx + dir]
    if (!swap) return
    setBusy(true)
    await Promise.all([
      supabase.from('network_marketing_products').update({ order_index: swap.order_index }).eq('id', p.id),
      supabase.from('network_marketing_products').update({ order_index: p.order_index }).eq('id', swap.id),
    ])
    setBusy(false)
    await reload()
  }

  async function toggleActive(p: NetworkMarketingProduct) {
    setBusy(true)
    await supabase.from('network_marketing_products').update({ is_active: !p.is_active }).eq('id', p.id)
    setBusy(false)
    await reload()
  }

  if (loading) return <p className="md-muted">Loading…</p>
  const sorted = [...products].sort((a, b) => a.order_index - b.order_index)

  return (
    <div>
      <div className="list-head">
        <h2>Products</h2>
        {!readOnly && <button type="button" onClick={openAdd}>+ Add Product</button>}
      </div>
      {error && <p className="form-error">{error}</p>}

      {sorted.length === 0 ? (
        <p className="empty-row">No products yet.</p>
      ) : (
        <div className="lc-section-list">
          {sorted.map((p, idx) => {
            const kinds = [p.video_resource_id && 'Video', p.pdf_resource_id && 'PDF', p.exam_id && 'Quiz', p.link_url && 'Link'].filter(Boolean)
            return (
              <div className={`lc-section-row ${p.is_active ? '' : 'archived'}`} key={p.id}>
                <span className="lc-section-ord">{String(idx + 1).padStart(2, '0')}</span>
                <div className="lc-section-main">
                  <h3>{p.name}{!p.is_active && ' · archived'}</h3>
                  {p.description && <p>{p.description}</p>}
                  <div className="lc-section-meta">{kinds.length ? kinds.join(' • ') : 'No content attached'}</div>
                </div>
                {!readOnly && (
                  <div className="lc-section-actions">
                    <button type="button" className="bp-move" onClick={() => move(p, -1)} disabled={busy || idx === 0}>↑</button>
                    <button type="button" className="bp-move" onClick={() => move(p, 1)} disabled={busy || idx === sorted.length - 1}>↓</button>
                    <button type="button" className="btn-ghost" onClick={() => openEdit(p)}>Edit</button>
                    <button type="button" className="btn-ghost" onClick={() => toggleActive(p)}>{p.is_active ? 'Archive' : 'Restore'}</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && !readOnly && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={save}>
              <h2>{editing ? 'Edit product' : 'Add product'}</h2>
              <label>Name<input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required autoFocus /></label>
              <label>Description<textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></label>
              <label>Video<select value={form.video_resource_id} onChange={(e) => setForm((f) => ({ ...f, video_resource_id: e.target.value }))}>
                <option value="">— None —</option>{videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select></label>
              <label>PDF<select value={form.pdf_resource_id} onChange={(e) => setForm((f) => ({ ...f, pdf_resource_id: e.target.value }))}>
                <option value="">— None —</option>{pdfs.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select></label>
              <label>Quiz<select value={form.exam_id} onChange={(e) => setForm((f) => ({ ...f, exam_id: e.target.value }))}>
                <option value="">— None —</option>{exams.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select></label>
              <label>External link (optional)<input type="url" value={form.link_url} onChange={(e) => setForm((f) => ({ ...f, link_url: e.target.value }))} placeholder="https://…" /></label>
              {error && <p className="form-error">{error}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
                <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
