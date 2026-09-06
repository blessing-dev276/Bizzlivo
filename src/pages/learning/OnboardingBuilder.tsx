import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import type { Exam, OnboardingItemType, OnboardingModule, OnboardingStepItem } from '../../types/database'

const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const TYPE_LABEL: Record<OnboardingItemType, string> = { pdf: 'PDF', video: 'Video', link: 'Link', quiz: 'Quiz' }

export default function OnboardingBuilder({ readOnly = false }: { readOnly?: boolean }) {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [modules, setModules] = useState<OnboardingModule[]>([])
  const [items, setItems] = useState<OnboardingStepItem[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [regLink, setRegLink] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showAddModule, setShowAddModule] = useState(false)
  const [modTitle, setModTitle] = useState('')
  const [modDesc, setModDesc] = useState('')
  // module being edited (title / description)
  const [editingModule, setEditingModule] = useState<OnboardingModule | null>(null)

  // item modal — `addToModule` set = adding a new item; `editingItem` set = editing one
  const [addToModule, setAddToModule] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<OnboardingStepItem | null>(null)
  const [itemType, setItemType] = useState<OnboardingItemType>('video')
  const [itemTitle, setItemTitle] = useState('')
  const [itemFile, setItemFile] = useState<File | null>(null)
  const [itemLink, setItemLink] = useState('')
  const [itemExamId, setItemExamId] = useState('')

  const reload = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const [modsRes, itemsRes, examsRes, settingsRes] = await Promise.all([
      supabase.from('onboarding_modules').select('*').eq('org_id', orgId).order('order_index', { ascending: true }),
      supabase.from('onboarding_step_items').select('*').eq('org_id', orgId).order('order_index', { ascending: true }),
      supabase.from('exams').select('*').eq('org_id', orgId).eq('status', 'published').order('title'),
      supabase.from('onboarding_settings').select('registration_link').eq('org_id', orgId).maybeSingle(),
    ])
    setModules((modsRes.data as OnboardingModule[]) ?? [])
    setItems((itemsRes.data as OnboardingStepItem[]) ?? [])
    setExams((examsRes.data as Exam[]) ?? [])
    setRegLink((settingsRes.data?.registration_link as string) ?? '')
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  async function addModule(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !modTitle.trim()) return
    setBusy(true)
    setError(null)
    const { error: e1 } = await supabase.from('onboarding_modules').insert({
      org_id: orgId,
      title: modTitle.trim(),
      description: modDesc.trim() || null,
      order_index: modules.length,
      created_by: profile.id,
    })
    setBusy(false)
    if (e1) { setError(e1.message); return }
    setModTitle('')
    setModDesc('')
    setShowAddModule(false)
    await reload()
  }

  function openEditModule(mod: OnboardingModule) {
    setEditingModule(mod)
    setModTitle(mod.title)
    setModDesc(mod.description ?? '')
    setError(null)
  }

  async function saveModule(e: FormEvent) {
    e.preventDefault()
    if (!editingModule || !modTitle.trim()) return
    setBusy(true)
    setError(null)
    const { error: e1 } = await supabase
      .from('onboarding_modules')
      .update({ title: modTitle.trim(), description: modDesc.trim() || null })
      .eq('id', editingModule.id)
    setBusy(false)
    if (e1) { setError(e1.message); return }
    setEditingModule(null)
    setModTitle('')
    setModDesc('')
    await reload()
  }

  async function moveModule(mod: OnboardingModule, dir: -1 | 1) {
    const sorted = [...modules].sort((a, b) => a.order_index - b.order_index)
    const idx = sorted.findIndex((m) => m.id === mod.id)
    const swap = sorted[idx + dir]
    if (!swap) return
    setBusy(true)
    await Promise.all([
      supabase.from('onboarding_modules').update({ order_index: swap.order_index }).eq('id', mod.id),
      supabase.from('onboarding_modules').update({ order_index: mod.order_index }).eq('id', swap.id),
    ])
    setBusy(false)
    await reload()
  }

  async function toggleModuleStatus(mod: OnboardingModule) {
    setBusy(true)
    await supabase.from('onboarding_modules').update({ status: mod.status === 'published' ? 'draft' : 'published' }).eq('id', mod.id)
    setBusy(false)
    await reload()
  }

  async function deleteModule(mod: OnboardingModule) {
    if (!confirm(`Delete "${mod.title}" and its content? Members' completion of those items is kept elsewhere.`)) return
    setBusy(true)
    await supabase.from('onboarding_modules').delete().eq('id', mod.id)
    setBusy(false)
    await reload()
  }

  function openAddItem(moduleId: string) {
    setAddToModule(moduleId)
    setEditingItem(null)
    setItemType('video')
    setItemTitle('')
    setItemFile(null)
    setItemLink('')
    setItemExamId('')
    setError(null)
  }

  function openEditItem(item: OnboardingStepItem) {
    setEditingItem(item)
    setAddToModule(null)
    setItemType(item.type)
    setItemTitle(item.title)
    setItemFile(null)
    setItemLink(item.link_url ?? '')
    setItemExamId(item.exam_id ?? '')
    setError(null)
  }

  function closeItemModal() {
    setAddToModule(null)
    setEditingItem(null)
  }

  // Upload a pdf/video file for an item and return its storage path.
  async function uploadItemFile(moduleId: string, itemId: string, type: 'pdf' | 'video', file: File) {
    if (type === 'pdf' && file.type !== 'application/pdf') throw new Error('That file is not a PDF.')
    if (type === 'video' && !file.type.startsWith('video/')) throw new Error('That file is not a video.')
    if (file.size > (type === 'pdf' ? MAX_PDF_BYTES : MAX_VIDEO_BYTES)) {
      throw new Error(`File too large — limit is ${type === 'pdf' ? '20MB' : '200MB'}.`)
    }
    const ext = file.name.split('.').pop() || (type === 'pdf' ? 'pdf' : 'mp4')
    const path = `${orgId}/${moduleId}/${itemId}.${ext}`
    const { error: upErr } = await supabase.storage.from('onboarding').upload(path, file, { contentType: file.type, upsert: true })
    if (upErr) throw upErr
    return path
  }

  async function addItem() {
    if (!addToModule || !orgId || !profile) return
    const mod = modules.find((m) => m.id === addToModule)
    if (!mod) return
    const count = items.filter((i) => i.module_id === addToModule).length
    // legacy `step` is NOT NULL — keep a value; new code reads module_id.
    const legacyStep = (items.find((i) => i.module_id === addToModule)?.step) ?? 'business_explanation'
    const base = { org_id: orgId, module_id: addToModule, step: legacyStep, type: itemType, title: itemTitle.trim(), order_index: count, created_by: profile.id }

    if (itemType === 'link') {
      if (!itemLink.trim()) throw new Error('Enter a link.')
      const { error: e1 } = await supabase.from('onboarding_step_items').insert({ ...base, link_url: itemLink.trim() })
      if (e1) throw e1
    } else if (itemType === 'quiz') {
      if (!itemExamId) throw new Error('Pick a published quiz.')
      const { error: e1 } = await supabase.from('onboarding_step_items').insert({ ...base, exam_id: itemExamId })
      if (e1) throw e1
    } else {
      if (!itemFile) throw new Error(`Choose a ${itemType} file.`)
      const itemId = crypto.randomUUID()
      const path = await uploadItemFile(addToModule, itemId, itemType as "pdf" | "video", itemFile)
      const { error: e1 } = await supabase.from('onboarding_step_items').insert({ ...base, id: itemId, file_path: path })
      if (e1) throw e1
    }
  }

  async function saveItem() {
    const item = editingItem
    if (!item || !orgId) return
    if (!itemTitle.trim()) throw new Error('Enter a title.')

    const patch: Partial<OnboardingStepItem> = { title: itemTitle.trim(), type: itemType }

    if (itemType === 'link') {
      if (!itemLink.trim()) throw new Error('Enter a link.')
      patch.link_url = itemLink.trim()
      patch.file_path = null
      patch.exam_id = null
      if (item.file_path) await supabase.storage.from('onboarding').remove([item.file_path])
    } else if (itemType === 'quiz') {
      if (!itemExamId) throw new Error('Pick a published quiz.')
      patch.exam_id = itemExamId
      patch.file_path = null
      patch.link_url = null
      if (item.file_path) await supabase.storage.from('onboarding').remove([item.file_path])
    } else {
      // pdf / video — keep the current file unless a new one is chosen
      if (itemFile) {
        if (!item.module_id) throw new Error('This item is missing its module.')
        const newPath = await uploadItemFile(item.module_id, item.id, itemType as "pdf" | "video", itemFile)
        if (item.file_path && item.file_path !== newPath) await supabase.storage.from('onboarding').remove([item.file_path])
        patch.file_path = newPath
      } else if (!item.file_path || item.type !== itemType) {
        throw new Error(`Choose a ${itemType} file.`)
      }
      patch.link_url = null
      patch.exam_id = null
    }

    const { error: e1 } = await supabase.from('onboarding_step_items').update(patch).eq('id', item.id)
    if (e1) throw e1
  }

  async function submitItem(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (editingItem) await saveItem()
      else await addItem()
      closeItemModal()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this item.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteItem(item: OnboardingStepItem) {
    if (!confirm(`Remove "${item.title}"?`)) return
    setBusy(true)
    if (item.file_path) await supabase.storage.from('onboarding').remove([item.file_path])
    await supabase.from('onboarding_step_items').delete().eq('id', item.id)
    setBusy(false)
    await reload()
  }

  async function saveRegLink(e: FormEvent) {
    e.preventDefault()
    if (!orgId) return
    setBusy(true)
    await supabase.from('onboarding_settings').upsert({ org_id: orgId, registration_link: regLink.trim() || null, updated_at: new Date().toISOString() })
    setBusy(false)
  }

  if (loading) return <p className="md-muted">Loading…</p>
  const sorted = [...modules].sort((a, b) => a.order_index - b.order_index)
  const itemModalOpen = (addToModule || editingItem) && !readOnly

  return (
    <div>
      <div className="list-head">
        <h2>Onboarding modules</h2>
        {!readOnly && <button type="button" onClick={() => setShowAddModule(true)}>+ Add Module</button>}
      </div>
      {error && !itemModalOpen && !editingModule && <p className="form-error">{error}</p>}

      {sorted.length === 0 ? (
        <p className="empty-row">No modules yet. Each module is a step in the new-member journey.</p>
      ) : (
        sorted.map((mod, idx) => {
          const modItems = items.filter((i) => i.module_id === mod.id)
          return (
            <div className="lc-module-card" key={mod.id}>
              <div className="lc-module-head">
                <span className="lc-section-ord">{String(idx + 1).padStart(2, '0')}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3>{mod.title}</h3>
                  {mod.description && <p className="md-muted">{mod.description}</p>}
                  <span className="lc-section-meta">
                    {modItems.length} item{modItems.length === 1 ? '' : 's'} ·{' '}
                    <span className={`badge ${mod.status === 'published' ? 'published' : 'draft'}`}>{mod.status}</span>
                  </span>
                </div>
                {!readOnly && (
                  <div className="lc-section-actions">
                    <button type="button" className="bp-move" onClick={() => moveModule(mod, -1)} disabled={busy || idx === 0}>↑</button>
                    <button type="button" className="bp-move" onClick={() => moveModule(mod, 1)} disabled={busy || idx === sorted.length - 1}>↓</button>
                    <button type="button" className="btn-ghost" onClick={() => openEditModule(mod)}>Edit</button>
                    <button type="button" className="btn-ghost" onClick={() => toggleModuleStatus(mod)}>{mod.status === 'published' ? 'Unpublish' : 'Publish'}</button>
                    <button type="button" className="btn-ghost" onClick={() => deleteModule(mod)}>Delete</button>
                  </div>
                )}
              </div>
              <div className="lc-item-list">
                {modItems.map((it) => (
                  <div className="lc-item-row" key={it.id}>
                    <span className="badge">{TYPE_LABEL[it.type]}</span>
                    <span className="lc-item-title">{it.title}</span>
                    {!readOnly && (
                      <>
                        <button type="button" className="btn-ghost" onClick={() => openEditItem(it)}>Edit</button>
                        <button type="button" className="btn-ghost" onClick={() => deleteItem(it)}>Remove</button>
                      </>
                    )}
                  </div>
                ))}
                {!readOnly && <button type="button" className="btn-ghost" onClick={() => openAddItem(mod.id)}>+ Add Content</button>}
              </div>
            </div>
          )
        })
      )}

      <form onSubmit={saveRegLink} className="upload-panel" style={{ marginTop: 20 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 15, marginBottom: 10 }}>Registration link</h2>
        <label>
          The external form new members fill out last
          <input value={regLink} onChange={(e) => setRegLink(e.target.value)} placeholder="https://…" disabled={readOnly} />
        </label>
        {!readOnly && <button type="submit" disabled={busy}>Save link</button>}
      </form>

      {showAddModule && !readOnly && (
        <div className="modal-backdrop" onClick={() => setShowAddModule(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={addModule}>
              <h2>Add module</h2>
              <label>Title<input value={modTitle} onChange={(e) => setModTitle(e.target.value)} required autoFocus /></label>
              <label>Description (optional)<textarea rows={2} value={modDesc} onChange={(e) => setModDesc(e.target.value)} /></label>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy || !modTitle.trim()}>{busy ? 'Adding…' : 'Add module'}</button>
                <button type="button" className="secondary" onClick={() => setShowAddModule(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingModule && !readOnly && (
        <div className="modal-backdrop" onClick={() => setEditingModule(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={saveModule}>
              <h2>Edit module</h2>
              <label>Title<input value={modTitle} onChange={(e) => setModTitle(e.target.value)} required autoFocus /></label>
              <label>Description (optional)<textarea rows={2} value={modDesc} onChange={(e) => setModDesc(e.target.value)} /></label>
              {error && <p className="form-error">{error}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy || !modTitle.trim()}>{busy ? 'Saving…' : 'Save changes'}</button>
                <button type="button" className="secondary" onClick={() => setEditingModule(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {itemModalOpen && (
        <div className="modal-backdrop" onClick={closeItemModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submitItem}>
              <h2>{editingItem ? 'Edit content' : 'Add content'}</h2>
              <label>
                Type
                <select value={itemType} onChange={(e) => setItemType(e.target.value as OnboardingItemType)}>
                  <option value="video">Video (upload)</option>
                  <option value="pdf">PDF (upload)</option>
                  <option value="link">Link</option>
                  <option value="quiz">Quiz (existing)</option>
                </select>
              </label>
              <label>Title<input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} required /></label>
              {(itemType === 'video' || itemType === 'pdf') && (
                <label>
                  {editingItem && editingItem.file_path && editingItem.type === itemType ? 'Replace file (optional)' : 'File'}
                  <input type="file" accept={itemType === 'pdf' ? 'application/pdf' : 'video/*'} onChange={(e) => setItemFile(e.target.files?.[0] ?? null)} />
                  {editingItem?.file_path && editingItem.type === itemType && !itemFile && (
                    <span className="md-muted" style={{ fontSize: 12 }}>Keeping the current file unless you choose a new one.</span>
                  )}
                </label>
              )}
              {itemType === 'link' && <label>URL<input type="url" value={itemLink} onChange={(e) => setItemLink(e.target.value)} placeholder="https://…" /></label>}
              {itemType === 'quiz' && (
                <label>
                  Quiz
                  <select value={itemExamId} onChange={(e) => setItemExamId(e.target.value)}>
                    <option value="">— Select —</option>
                    {exams.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                  </select>
                </label>
              )}
              {error && <p className="form-error">{error}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy}>{busy ? 'Saving…' : editingItem ? 'Save changes' : 'Add content'}</button>
                <button type="button" className="secondary" onClick={closeItemModal}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
