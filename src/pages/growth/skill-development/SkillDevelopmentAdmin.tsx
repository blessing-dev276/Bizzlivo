import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import type { ClassPurpose, ClassStatus, SkillClass } from '../../../types/database'

type FilterTab = 'all' | ClassStatus

interface ClassRow extends SkillClass {
  moduleCount: number
  itemCount: number
}

interface Props {
  purpose: ClassPurpose
}

// Shared by Skill Development and Income Development's Skill Catalog —
// same classes/class_modules/class_module_items schema and editor, tagged
// by `purpose` (see 0029_class_purpose.sql). `purpose` picks which classes
// this instance lists/creates.
export default function SkillDevelopmentAdmin({ purpose }: Props) {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const navigate = useNavigate()

  const [rows, setRows] = useState<ClassRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')

  const [showNew, setShowNew] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(org: string) {
    setLoading(true)
    const { data: classData } = await supabase
      .from('classes')
      .select('*')
      .eq('org_id', org)
      .eq('purpose', purpose)
      .order('created_at', { ascending: false })
    const classes = (classData as SkillClass[]) ?? []
    const classIds = classes.map((c) => c.id)
    if (classIds.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    const { data: moduleData } = await supabase.from('class_modules').select('id, class_id').in('class_id', classIds)
    const modules = (moduleData as { id: string; class_id: string }[]) ?? []
    const moduleIds = modules.map((m) => m.id)
    const { data: itemData } =
      moduleIds.length > 0
        ? await supabase.from('class_module_items').select('module_id').in('module_id', moduleIds)
        : { data: [] as { module_id: string }[] }

    const moduleCountByClass = new Map<string, number>()
    for (const m of modules) moduleCountByClass.set(m.class_id, (moduleCountByClass.get(m.class_id) ?? 0) + 1)
    const moduleToClass = new Map(modules.map((m) => [m.id, m.class_id]))
    const itemCountByClass = new Map<string, number>()
    for (const i of itemData ?? []) {
      const classId = moduleToClass.get(i.module_id)
      if (!classId) continue
      itemCountByClass.set(classId, (itemCountByClass.get(classId) ?? 0) + 1)
    }

    setRows(
      classes.map((c) => ({
        ...c,
        moduleCount: moduleCountByClass.get(c.id) ?? 0,
        itemCount: itemCountByClass.get(c.id) ?? 0,
      }))
    )
    setLoading(false)
  }

  useEffect(() => {
    if (!orgId) return
    load(orgId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, purpose])

  const counts = useMemo(
    () => ({
      draft: rows.filter((r) => r.status === 'draft').length,
      published: rows.filter((r) => r.status === 'published').length,
      archived: rows.filter((r) => r.status === 'archived').length,
    }),
    [rows]
  )

  const visible = useMemo(
    () =>
      rows
        .filter((r) => filter === 'all' || r.status === filter)
        .filter((r) => r.title.toLowerCase().includes(search.trim().toLowerCase())),
    [rows, filter, search]
  )

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !title.trim()) return
    setCreating(true)
    setError(null)
    const { data, error: insertError } = await supabase
      .from('classes')
      .insert({ org_id: orgId, title: title.trim(), description: description.trim() || null, purpose, created_by: profile.id })
      .select()
      .single()
    setCreating(false)
    if (insertError || !data) {
      setError(insertError?.message ?? 'Could not create class.')
      return
    }
    navigate(`/training/classes/${data.id}`)
  }

  return (
    <div>
      <div className="page-head list-header" style={{ marginBottom: 0 }}>
        <p style={{ color: 'var(--text-dim)', margin: 0 }}>
          Build your office's curriculum — a Class holds any number of Modules you name yourself, each with video,
          PDF, article, test, quiz, or assignment resources.
        </p>
        <button type="button" onClick={() => setShowNew(true)}>+ New class</button>
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <div className="chips">
          <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All · {rows.length}</button>
          <button className={`chip ${filter === 'draft' ? 'active' : ''}`} onClick={() => setFilter('draft')}>Draft · {counts.draft}</button>
          <button className={`chip ${filter === 'published' ? 'active' : ''}`} onClick={() => setFilter('published')}>Published · {counts.published}</button>
          <button className={`chip ${filter === 'archived' ? 'active' : ''}`} onClick={() => setFilter('archived')}>Archived · {counts.archived}</button>
        </div>
        <div className="search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
          <input type="text" placeholder="Search classes..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {showNew && (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleCreate}>
              <h2>New class</h2>
              <label>
                Class title
                <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="e.g. Graphics Design" />
              </label>
              <label>
                Description (optional)
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What will members learn in this class?" />
              </label>
              {error && <p className="form-error">{error}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={creating || !title.trim()}>{creating ? 'Creating…' : 'Create & add modules →'}</button>
                <button type="button" className="secondary" onClick={() => setShowNew(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : visible.length === 0 ? (
        <p>{rows.length === 0 ? 'No classes yet — create one to start building your curriculum.' : 'No classes match this search.'}</p>
      ) : (
        <div className="exam-list" style={{ marginTop: 16 }}>
          {visible.map((c) => (
            <div className="exam-card" key={c.id}>
              <div className="exam-top">
                <div className="exam-title-block">
                  <h3><Link to={`/training/classes/${c.id}`}>{c.title}</Link></h3>
                  <div className="exam-sub">created {new Date(c.created_at).toLocaleDateString()}</div>
                </div>
                <span className={`badge ${c.status}`}>{c.status}</span>
              </div>
              <div className="exam-meta">
                <div className="meta-item">
                  <span className="meta-strong">{c.moduleCount}</span>&nbsp;module{c.moduleCount === 1 ? '' : 's'}
                </div>
                <span className="meta-div" />
                <div className="meta-item">
                  <span className="meta-strong">{c.itemCount}</span>&nbsp;item{c.itemCount === 1 ? '' : 's'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
