import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { areaDef, createSection, loadSections, type Section } from '../../lib/learningCenter'
import type { LearningArea, NetworkMarketingBasic } from '../../types/database'

export default function CurriculumBuilder({
  area,
  showLegacyImport = false,
}: {
  area: LearningArea
  showLegacyImport?: boolean
}) {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const def = areaDef(area)

  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [legacyBasics, setLegacyBasics] = useState<NetworkMarketingBasic[]>([])

  const reload = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const rows = await loadSections(orgId, area)
    setSections(rows)
    if (showLegacyImport) {
      const { data } = await supabase.from('network_marketing_basics').select('*').eq('org_id', orgId).order('created_at')
      setLegacyBasics((data as NetworkMarketingBasic[]) ?? [])
    }
    setLoading(false)
  }, [orgId, area, showLegacyImport])

  useEffect(() => {
    reload()
  }, [reload])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !title.trim()) return
    setBusy(true)
    setError(null)
    const nextOrder = sections.length ? Math.max(...sections.map((s) => s.section_order)) + 1 : 0
    const { error: e1 } = await createSection(orgId, area, profile.id, title.trim(), nextOrder)
    setBusy(false)
    if (e1) {
      setError(e1.message)
      return
    }
    setTitle('')
    setShowAdd(false)
    await reload()
  }

  async function move(section: Section, dir: -1 | 1) {
    const sorted = [...sections].sort((a, b) => a.section_order - b.section_order)
    const idx = sorted.findIndex((s) => s.id === section.id)
    const swap = sorted[idx + dir]
    if (!swap) return
    setBusy(true)
    await Promise.all([
      supabase.from('classes').update({ section_order: swap.section_order }).eq('id', section.id),
      supabase.from('classes').update({ section_order: section.section_order }).eq('id', swap.id),
    ])
    setBusy(false)
    await reload()
  }

  async function toggleArchive(section: Section) {
    const next = section.status === 'archived' ? 'draft' : 'archived'
    if (next === 'archived' && !confirm(`Archive "${section.title}"? Members stop seeing it; their progress and its content are kept.`)) return
    setBusy(true)
    await supabase.from('classes').update({ status: next }).eq('id', section.id)
    setBusy(false)
    await reload()
  }

  async function importLegacyBasics() {
    if (!orgId || !profile || legacyBasics.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const nextOrder = sections.length ? Math.max(...sections.map((s) => s.section_order)) + 1 : 0
      const { data: cls, error: e1 } = await supabase
        .from('classes')
        .insert({ org_id: orgId, area, purpose: null, title: 'NeoLife Basics', description: 'Foundational NeoLife training.', status: 'published', section_order: nextOrder, created_by: profile.id })
        .select('id')
        .single()
      if (e1 || !cls) throw e1 ?? new Error('Could not create the section.')
      for (let i = 0; i < legacyBasics.length; i++) {
        const b = legacyBasics[i]
        const { data: mod, error: e2 } = await supabase
          .from('class_modules')
          .insert({ class_id: cls.id, org_id: orgId, title: b.title, description: b.description, order_index: i, status: 'published' })
          .select('id')
          .single()
        if (e2 || !mod) throw e2 ?? new Error('Could not create a lesson.')
        if (b.link_url) {
          await supabase.from('class_module_items').insert({
            module_id: mod.id, org_id: orgId, type: 'link', title: 'Open resource', order_index: 0, link_url: b.link_url, created_by: profile.id,
          })
        }
      }
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="md-muted">Loading…</p>

  const sorted = [...sections].sort((a, b) => a.section_order - b.section_order)
  const hasBasicsSection = sorted.some((s) => s.title.toLowerCase() === 'neolife basics')

  return (
    <div>
      {showLegacyImport && legacyBasics.length > 0 && !hasBasicsSection && (
        <div className="lc-import">
          <span>{legacyBasics.length} NeoLife Basics item{legacyBasics.length === 1 ? '' : 's'} from the old catalog can be brought into the new structure.</span>
          <button type="button" onClick={importLegacyBasics} disabled={busy}>{busy ? 'Importing…' : 'Import them'}</button>
        </div>
      )}

      <div className="list-head">
        <h2>{def?.label} sections</h2>
        <button type="button" onClick={() => setShowAdd(true)}>+ Add Section</button>
      </div>
      {error && <p className="form-error">{error}</p>}

      {sorted.length === 0 ? (
        <p className="empty-row">No sections yet. A section groups related modules — e.g. "Skill Learning", "Portfolio Development".</p>
      ) : (
        <div className="lc-section-list">
          {sorted.map((s, idx) => (
            <div className={`lc-section-row ${s.status === 'archived' ? 'archived' : ''}`} key={s.id}>
              <span className="lc-section-ord">{String(idx + 1).padStart(2, '0')}</span>
              <div className="lc-section-main">
                <h3>{s.title}</h3>
                {s.description && <p>{s.description}</p>}
                <div className="lc-section-meta">
                  {s.moduleCount} module{s.moduleCount === 1 ? '' : 's'} · {s.itemCount} item{s.itemCount === 1 ? '' : 's'} ·{' '}
                  <span className={`badge ${s.status === 'published' ? 'published' : s.status === 'archived' ? '' : 'draft'}`}>{s.status}</span>
                </div>
              </div>
              <div className="lc-section-actions">
                <button type="button" className="bp-move" onClick={() => move(s, -1)} disabled={busy || idx === 0}>↑</button>
                <button type="button" className="bp-move" onClick={() => move(s, 1)} disabled={busy || idx === sorted.length - 1}>↓</button>
                <Link to={`/training/classes/${s.id}`} className="btn-primary-link">Manage →</Link>
                <button type="button" className="btn-ghost" onClick={() => toggleArchive(s)}>{s.status === 'archived' ? 'Restore' : 'Archive'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={add}>
              <h2>Add a section to {def?.label}</h2>
              <label>
                Section title
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Skill Learning" autoFocus required />
              </label>
              {error && <p className="form-error">{error}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy || !title.trim()}>{busy ? 'Adding…' : 'Add section'}</button>
                <button type="button" className="secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
