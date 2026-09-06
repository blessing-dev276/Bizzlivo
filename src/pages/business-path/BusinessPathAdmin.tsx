import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { loadAllRanks, seedDefaultRanks } from '../../lib/businessPath'
import ApprovalQueue from './ApprovalQueue'
import type { BusinessPathRank, PromotionMode } from '../../types/database'

interface RankForm {
  name: string
  description: string
  color: string
  icon: string
  promotion_mode: PromotionMode
  is_active: boolean
}
const BLANK: RankForm = { name: '', description: '', color: '', icon: '', promotion_mode: 'automatic', is_active: true }

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'rank'
}

export default function BusinessPathAdmin({ readOnly = false }: { readOnly?: boolean }) {
  const { currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id

  const [ranks, setRanks] = useState<BusinessPathRank[]>([])
  const [counts, setCounts] = useState<Map<string, { learning: number; task: number }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<BusinessPathRank | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<RankForm>(BLANK)

  async function load(org: string) {
    setLoading(true)
    const [rankRows, { data: itemRows }] = await Promise.all([
      loadAllRanks(org),
      supabase.from('business_path_items').select('rank_id, section').eq('org_id', org),
    ])
    setRanks(rankRows)
    const m = new Map<string, { learning: number; task: number }>()
    for (const r of (itemRows as { rank_id: string; section: string }[]) ?? []) {
      const c = m.get(r.rank_id) ?? { learning: 0, task: 0 }
      if (r.section === 'learning') c.learning += 1
      else c.task += 1
      m.set(r.rank_id, c)
    }
    setCounts(m)
    setLoading(false)
  }

  useEffect(() => {
    if (!orgId) return
    load(orgId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const existingSlugs = useMemo(() => new Set(ranks.map((r) => r.slug)), [ranks])

  function openAdd() {
    setEditing(null)
    setForm(BLANK)
    setError(null)
    setShowForm(true)
  }
  function openEdit(rank: BusinessPathRank) {
    setEditing(rank)
    setForm({
      name: rank.name,
      description: rank.description ?? '',
      color: rank.color ?? '',
      icon: rank.icon ?? '',
      promotion_mode: rank.promotion_mode,
      is_active: rank.is_active,
    })
    setError(null)
    setShowForm(true)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !form.name.trim()) return
    setBusy(true)
    setError(null)
    try {
      if (editing) {
        const { error: e1 } = await supabase
          .from('business_path_ranks')
          .update({
            name: form.name.trim(),
            description: form.description.trim() || null,
            color: form.color.trim() || null,
            icon: form.icon.trim() || null,
            promotion_mode: form.promotion_mode,
            is_active: form.is_active,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editing.id)
        if (e1) throw e1
      } else {
        let slug = slugify(form.name)
        let n = 2
        while (existingSlugs.has(slug)) slug = `${slugify(form.name)}_${n++}`
        const nextOrder = ranks.length ? Math.max(...ranks.map((r) => r.order_index)) + 1 : 0
        const { error: e2 } = await supabase.from('business_path_ranks').insert({
          org_id: orgId,
          slug,
          name: form.name.trim(),
          description: form.description.trim() || null,
          color: form.color.trim() || null,
          icon: form.icon.trim() || null,
          promotion_mode: form.promotion_mode,
          order_index: nextOrder,
        })
        if (e2) throw e2
      }
      setShowForm(false)
      await load(orgId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this rank.')
    } finally {
      setBusy(false)
    }
  }

  async function move(rank: BusinessPathRank, dir: -1 | 1) {
    if (!orgId) return
    const sorted = [...ranks].sort((a, b) => a.order_index - b.order_index)
    const idx = sorted.findIndex((r) => r.id === rank.id)
    const swap = sorted[idx + dir]
    if (!swap) return
    setBusy(true)
    await Promise.all([
      supabase.from('business_path_ranks').update({ order_index: swap.order_index }).eq('id', rank.id),
      supabase.from('business_path_ranks').update({ order_index: rank.order_index }).eq('id', swap.id),
    ])
    setBusy(false)
    await load(orgId)
  }

  async function toggleActive(rank: BusinessPathRank) {
    if (!orgId) return
    if (rank.is_active && !confirm(`Archive "${rank.name}"? Members already on this rank keep their progress and history; it just stops new members reaching it.`)) return
    setBusy(true)
    await supabase.from('business_path_ranks').update({ is_active: !rank.is_active, updated_at: new Date().toISOString() }).eq('id', rank.id)
    setBusy(false)
    await load(orgId)
  }

  if (loading) return <div className="page bp"><div className="bp-head"><h1>Business Path</h1></div><p className="md-muted">Loading…</p></div>

  const sorted = [...ranks].sort((a, b) => a.order_index - b.order_index)

  return (
    <div className="page bp">
      <div className="bp-head list-header">
        <div>
          <h1>Business Path</h1>
          <p>
            The rank journey every member walks through. Each rank has a Learning Path and Business Tasks that
            point at content and activity you already run in Bizzlivo.
          </p>
        </div>
        {!readOnly && <button type="button" onClick={openAdd}>+ Add Rank</button>}
      </div>

      <ApprovalQueue readOnly={readOnly} />

      {readOnly && (
        <p style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>
          You can view the journey. Only an admin can change ranks or paths.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}

      {sorted.length === 0 ? (
        <div className="empty-office-card" style={{ marginTop: 16 }}>
          <h2>Build your rank journey</h2>
          <p>Start from the standard six-rank ladder and adjust it, or add ranks one at a time.</p>
          {!readOnly && (
            <div className="empty-office-actions">
              <button
                type="button"
                onClick={async () => {
                  if (!orgId) return
                  setBusy(true)
                  await seedDefaultRanks(orgId)
                  setBusy(false)
                  await load(orgId)
                }}
                disabled={busy}
              >
                Use the standard ladder
              </button>
              <button type="button" className="secondary" onClick={openAdd}>Add a rank</button>
            </div>
          )}
        </div>
      ) : (
        <div className="bp-admin-list" style={{ marginTop: 8 }}>
          {sorted.map((rank, idx) => {
            const c = counts.get(rank.id) ?? { learning: 0, task: 0 }
            return (
              <div className={`bp-rank-row ${rank.is_active ? '' : 'inactive'}`} key={rank.id}>
                <span className="bp-rank-ord">{String(idx + 1).padStart(2, '0')}</span>
                <div className="bp-rank-main">
                  <h3>{rank.icon ? `${rank.icon} ` : ''}{rank.name}{!rank.is_active && ' · archived'}</h3>
                  {rank.description && <p>{rank.description}</p>}
                  <div className="bp-rank-counts">
                    {c.learning} learning · {c.task} tasks · promotes {rank.promotion_mode === 'automatic' ? 'automatically' : 'on staff approval'}
                  </div>
                </div>
                <div className="bp-rank-actions">
                  {!readOnly && (
                    <>
                      <button type="button" className="bp-move" onClick={() => move(rank, -1)} disabled={busy || idx === 0}>↑</button>
                      <button type="button" className="bp-move" onClick={() => move(rank, 1)} disabled={busy || idx === sorted.length - 1}>↓</button>
                      <button type="button" className="btn-ghost" onClick={() => openEdit(rank)}>Edit</button>
                    </>
                  )}
                  <Link to={`/business-path/ranks/${rank.id}`} className="btn-primary-link">{readOnly ? 'View path →' : 'Manage Path →'}</Link>
                  {!readOnly && (
                    <button type="button" className="btn-ghost" onClick={() => toggleActive(rank)}>
                      {rank.is_active ? 'Archive' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && !readOnly && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={save}>
              <h2>{editing ? 'Edit rank' : 'Add rank'}</h2>
              <label>
                Name
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required autoFocus />
              </label>
              <label>
                Description (optional)
                <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </label>
              <div className="field-row">
                <label style={{ maxWidth: 120 }}>
                  Icon (optional)
                  <input value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} placeholder="🚀" />
                </label>
                <label style={{ maxWidth: 140 }}>
                  Color (optional)
                  <input value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} placeholder="#3b74f0" />
                </label>
              </div>
              <label>
                Promotion
                <select value={form.promotion_mode} onChange={(e) => setForm((f) => ({ ...f, promotion_mode: e.target.value as PromotionMode }))}>
                  <option value="automatic">Automatic — advance the moment every requirement is done</option>
                  <option value="approval">Staff approval — a leader confirms the promotion</option>
                </select>
              </label>
              {editing && (
                <label className="toggle-row" style={{ border: 'none', padding: 0 }}>
                  <span>Active</span>
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
                </label>
              )}
              {error && <p className="form-error">{error}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : editing ? 'Save' : 'Add rank'}</button>
                <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
