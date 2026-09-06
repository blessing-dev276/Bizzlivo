import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { PageSkeleton } from '../../../components/AppSkeleton'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../lib/AuthContext'
import { notifyUsers } from '../../../lib/notifications'
import { createResource, MAX_PDF_BYTES } from '../../../lib/createResource'
import { KIND_ICON } from '../../../lib/resourceKind'
import type {
  ClassModule,
  ClassModuleItem,
  ClassModuleItemType,
  ClassStatus,
  ClassTrainer,
  Exam,
  Resource,
  SkillClass,
} from '../../../types/database'

interface MemberOption {
  id: string
  full_name: string
  avatar_url: string | null
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0]?.toUpperCase() || '?'
}

const TYPE_LABEL: Record<ClassModuleItemType, string> = {
  video: 'Video',
  pdf: 'PDF',
  podcast: 'Podcast',
  link: 'Link',
  article: 'Article',
  test: 'Quiz',
  quiz: 'Quiz',
  assignment: 'Assignment',
}
// Types offered in the "add item" picker (test/quiz are the same thing).
const ITEM_TYPES: ClassModuleItemType[] = ['video', 'pdf', 'podcast', 'link', 'article', 'quiz', 'assignment']

const TYPE_ICON: Partial<Record<ClassModuleItemType, React.ReactNode>> = {
  video: KIND_ICON.video,
  pdf: KIND_ICON.pdf,
}

interface ItemForm {
  type: ClassModuleItemType
  title: string
  resourceId: string
  linkUrl: string
  body: string
  examId: string
  instructions: string
  referenceLink: string
  requireNote: boolean
  requireLink: boolean
  dueDate: string
}

const BLANK_ITEM_FORM: ItemForm = {
  type: 'video',
  title: '',
  resourceId: '',
  linkUrl: '',
  body: '',
  examId: '',
  instructions: '',
  referenceLink: '',
  requireNote: true,
  requireLink: false,
  dueDate: '',
}

export default function ClassEditor() {
  const { classId } = useParams<{ classId: string }>()
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const navigate = useNavigate()

  const [classInfo, setClassInfo] = useState<SkillClass | null>(null)
  const [modules, setModules] = useState<ClassModule[]>([])
  const [items, setItems] = useState<ClassModuleItem[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [trainers, setTrainers] = useState<(ClassTrainer & { profile: MemberOption | null })[]>([])
  const [members, setMembers] = useState<MemberOption[]>([])
  const [showTrainerPicker, setShowTrainerPicker] = useState(false)

  const [editingInfo, setEditingInfo] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')

  const [showNewModule, setShowNewModule] = useState(false)
  const [moduleTitleDraft, setModuleTitleDraft] = useState('')

  const [addItemModuleId, setAddItemModuleId] = useState<string | null>(null)
  const [itemForm, setItemForm] = useState<ItemForm>(BLANK_ITEM_FORM)

  const [showNewResource, setShowNewResource] = useState(false)
  const [newResourceTitle, setNewResourceTitle] = useState('')
  const [newResourceFile, setNewResourceFile] = useState<File | null>(null)
  const [newResourceLink, setNewResourceLink] = useState('')
  const [newResourceDragOver, setNewResourceDragOver] = useState(false)
  const [resourceUploading, setResourceUploading] = useState(false)
  const [resourceUploadError, setResourceUploadError] = useState<string | null>(null)
  const newResourceFileRef = useRef<HTMLInputElement | null>(null)

  const [busy, setBusy] = useState(false)

  async function load() {
    if (!classId) return
    setLoading(true)
    const { data: classData } = await supabase.from('classes').select('*').eq('id', classId).single()
    if (!classData) {
      setClassInfo(null)
      setLoading(false)
      return
    }
    setClassInfo(classData as SkillClass)

    const { data: moduleData } = await supabase
      .from('class_modules')
      .select('*')
      .eq('class_id', classId)
      .order('order_index', { ascending: true })
    const moduleRows = (moduleData as ClassModule[]) ?? []
    setModules(moduleRows)

    const moduleIds = moduleRows.map((m) => m.id)
    const { data: itemData } =
      moduleIds.length > 0
        ? await supabase.from('class_module_items').select('*').in('module_id', moduleIds).order('order_index', { ascending: true })
        : { data: [] as ClassModuleItem[] }
    setItems((itemData as ClassModuleItem[]) ?? [])

    const { data: trainerData } = await supabase
      .from('class_trainers')
      .select('*, profile:profiles(id, full_name, avatar_url)')
      .eq('class_id', classId)
    setTrainers((trainerData as unknown as (ClassTrainer & { profile: MemberOption | null })[]) ?? [])

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId])

  // Which resources.purpose bucket this class's video/PDF picker draws
  // from — Skill Development classes get 'skill_set' resources, Income
  // Development classes (which share this same editor, see
  // 0029_class_purpose.sql) get 'freelancing' ones. Personal Development's
  // 'book' resources never show here either way.
  const resourcePurpose =
    classInfo?.area === 'personal_development'
      ? 'book'
      : classInfo?.area === 'income_development' || classInfo?.purpose === 'income_development'
        ? 'freelancing'
        : 'skill_set'

  useEffect(() => {
    if (!orgId || !classInfo) return
    supabase
      .from('resources')
      .select('*')
      .eq('org_id', orgId)
      .eq('purpose', resourcePurpose)
      .order('title')
      .then(({ data }) => setResources((data as Resource[]) ?? []))
    supabase
      .from('exams')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'published')
      .order('title')
      .then(({ data }) => setExams((data as Exam[]) ?? []))
    // Trainer picker is scoped to members who actually hold the Trainer (or
    // Admin) role — matches has_org_role(...) on class_trainers' own RLS.
    supabase
      .from('memberships')
      .select('user_id, profile:profiles(id, full_name, avatar_url)')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('role', ['admin', 'trainer'])
      .then(({ data }) => {
        const rows = (data as unknown as { user_id: string; profile: MemberOption | null }[]) ?? []
        setMembers(rows.filter((r) => r.profile).map((r) => r.profile as MemberOption))
      })
    // classInfo?.id (not the whole object) — classInfo is a fresh object on
    // every load() call (i.e. after any mutation in this editor), and this
    // fetch only needs to (re-)run once the class itself first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, classInfo?.id])

  const itemsByModule = useMemo(() => {
    const map = new Map<string, ClassModuleItem[]>()
    for (const item of items) {
      if (!map.has(item.module_id)) map.set(item.module_id, [])
      map.get(item.module_id)!.push(item)
    }
    return map
  }, [items])

  if (loading) return <PageSkeleton />
  if (!classInfo) return <div className="page"><p>Class not found.</p></div>

  function startEditingInfo() {
    setTitleDraft(classInfo!.title)
    setDescriptionDraft(classInfo!.description ?? '')
    setEditingInfo(true)
  }

  async function saveInfo(e: FormEvent) {
    e.preventDefault()
    if (!titleDraft.trim()) return
    setBusy(true)
    const { error: updateError } = await supabase
      .from('classes')
      .update({ title: titleDraft.trim(), description: descriptionDraft.trim() || null })
      .eq('id', classInfo!.id)
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setEditingInfo(false)
    await load()
  }

  async function setStatus(status: ClassStatus) {
    if (status === 'published' && modules.length === 0) {
      setError('Add at least one module before publishing.')
      return
    }
    setError(null)
    setBusy(true)
    const { error: updateError } = await supabase.from('classes').update({ status }).eq('id', classInfo!.id)
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    if (status === 'published' && orgId) {
      try {
        const { data: memberRows } = await supabase.from('memberships').select('user_id').eq('org_id', orgId).eq('status', 'active')
        await notifyUsers(orgId, (memberRows ?? []).map((m) => m.user_id), 'class_published', {
          text: `New class published: "${classInfo!.title}"`,
          link: `/training/classes/${classInfo!.id}`,
        })
      } catch {
        // Non-fatal — publishing itself already succeeded.
      }
    }
    await load()
  }

  async function deleteClass() {
    if (!confirm(`Delete "${classInfo!.title}" permanently? This removes every module, item, and member progress in it — this can't be undone.`)) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('classes').delete().eq('id', classInfo!.id)
    setBusy(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    navigate('/training')
  }

  async function addTrainer(userId: string) {
    if (!orgId || !profile) return
    setBusy(true)
    const { error: insertError } = await supabase
      .from('class_trainers')
      .insert({ class_id: classInfo!.id, org_id: orgId, user_id: userId, added_by: profile.id })
    setBusy(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setShowTrainerPicker(false)
    await load()
  }

  async function removeTrainer(trainer: ClassTrainer) {
    setBusy(true)
    const { error: deleteError } = await supabase.from('class_trainers').delete().eq('id', trainer.id)
    setBusy(false)
    if (deleteError) setError(deleteError.message)
    else await load()
  }

  async function addModule(e: FormEvent) {
    e.preventDefault()
    if (!moduleTitleDraft.trim() || !orgId) return
    setBusy(true)
    const { error: insertError } = await supabase.from('class_modules').insert({
      class_id: classInfo!.id,
      org_id: orgId,
      title: moduleTitleDraft.trim(),
      order_index: modules.length,
    })
    setBusy(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setModuleTitleDraft('')
    setShowNewModule(false)
    await load()
  }

  async function renameModule(mod: ClassModule) {
    const next = prompt('Module name', mod.title)
    if (next === null || !next.trim() || next.trim() === mod.title) return
    const { error: updateError } = await supabase.from('class_modules').update({ title: next.trim() }).eq('id', mod.id)
    if (updateError) setError(updateError.message)
    else await load()
  }

  async function moveModule(mod: ClassModule, direction: -1 | 1) {
    const sorted = [...modules].sort((a, b) => a.order_index - b.order_index)
    const idx = sorted.findIndex((m) => m.id === mod.id)
    const swapWith = sorted[idx + direction]
    if (!swapWith) return
    setBusy(true)
    await Promise.all([
      supabase.from('class_modules').update({ order_index: swapWith.order_index }).eq('id', mod.id),
      supabase.from('class_modules').update({ order_index: mod.order_index }).eq('id', swapWith.id),
    ])
    setBusy(false)
    await load()
  }

  async function deleteModule(mod: ClassModule) {
    if (!confirm(`Delete module "${mod.title}" and everything in it?`)) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('class_modules').delete().eq('id', mod.id)
    setBusy(false)
    if (deleteError) setError(deleteError.message)
    else await load()
  }

  function resetNewResourceForm() {
    setShowNewResource(false)
    setNewResourceTitle('')
    setNewResourceFile(null)
    setNewResourceLink('')
    setResourceUploadError(null)
    if (newResourceFileRef.current) newResourceFileRef.current.value = ''
  }

  function openAddItem(moduleId: string) {
    setItemForm(BLANK_ITEM_FORM)
    setError(null)
    resetNewResourceForm()
    setAddItemModuleId(moduleId)
  }

  function pickNewResourceFile(f: File | null) {
    setResourceUploadError(null)
    if (!f) {
      setNewResourceFile(null)
      return
    }
    if (f.type !== 'application/pdf') {
      setResourceUploadError('Only PDF files are supported.')
      return
    }
    if (f.size > MAX_PDF_BYTES) {
      setResourceUploadError('File is too large — the limit is 20MB.')
      return
    }
    setNewResourceFile(f)
  }

  function handleNewResourceDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setNewResourceDragOver(false)
    pickNewResourceFile(e.dataTransfer.files?.[0] ?? null)
  }

  async function uploadNewResource() {
    if (!orgId || !profile) return
    const type = itemForm.type as 'pdf' | 'video' | 'podcast'
    setResourceUploadError(null)
    if (!newResourceTitle.trim()) {
      setResourceUploadError('Give it a title.')
      return
    }
    if (type === 'pdf' && !newResourceFile) {
      setResourceUploadError('Choose a PDF file.')
      return
    }
    if (type !== 'pdf' && !newResourceLink.trim()) {
      setResourceUploadError(`Enter a ${type} link.`)
      return
    }
    setResourceUploading(true)
    try {
      const resource = await createResource({
        orgId,
        uploadedBy: profile.id,
        title: newResourceTitle.trim(),
        kind: type,
        purpose: resourcePurpose,
        file: type === 'pdf' ? newResourceFile : null,
        linkUrl: type === 'pdf' ? null : newResourceLink,
      })
      setResources((prev) => [...prev, resource].sort((a, b) => a.title.localeCompare(b.title)))
      setItemForm((f) => ({ ...f, resourceId: resource.id }))
      resetNewResourceForm()
    } catch (err) {
      setResourceUploadError(err instanceof Error ? err.message : 'Could not add this resource.')
    } finally {
      setResourceUploading(false)
    }
  }

  async function addItem(e: FormEvent) {
    e.preventDefault()
    if (!addItemModuleId || !orgId || !profile || !itemForm.title.trim()) return

    const moduleItems = itemsByModule.get(addItemModuleId) ?? []
    const base = {
      module_id: addItemModuleId,
      org_id: orgId,
      type: itemForm.type,
      title: itemForm.title.trim(),
      order_index: moduleItems.length,
      created_by: profile.id,
    }

    setBusy(true)
    setError(null)
    try {
      if (itemForm.type === 'video' || itemForm.type === 'pdf' || itemForm.type === 'podcast') {
        if (!itemForm.resourceId) throw new Error(`Pick a ${TYPE_LABEL[itemForm.type].toLowerCase()} from your resource library.`)
        const { error: insertError } = await supabase.from('class_module_items').insert({ ...base, resource_id: itemForm.resourceId })
        if (insertError) throw insertError
      } else if (itemForm.type === 'link') {
        if (!itemForm.linkUrl.trim()) throw new Error('Enter a URL.')
        const { error: insertError } = await supabase.from('class_module_items').insert({ ...base, link_url: itemForm.linkUrl.trim() })
        if (insertError) throw insertError
      } else if (itemForm.type === 'article') {
        if (!itemForm.body.trim()) throw new Error('Write the article content.')
        const { error: insertError } = await supabase.from('class_module_items').insert({ ...base, body: itemForm.body.trim() })
        if (insertError) throw insertError
      } else if (itemForm.type === 'test' || itemForm.type === 'quiz') {
        if (!itemForm.examId) throw new Error('Pick a published exam to link.')
        const { error: insertError } = await supabase.from('class_module_items').insert({ ...base, exam_id: itemForm.examId })
        if (insertError) throw insertError
      } else {
        if (!itemForm.instructions.trim()) throw new Error('Write instructions for the assignment.')
        if (!itemForm.requireNote && !itemForm.requireLink) throw new Error('Require at least a text note or a link.')

        const { data: assignment, error: assignmentError } = await supabase
          .from('coursework_assignments')
          .insert({
            org_id: orgId,
            title: itemForm.title.trim(),
            instructions: itemForm.instructions.trim(),
            reference_link: itemForm.referenceLink.trim() || null,
            require_note: itemForm.requireNote,
            require_link: itemForm.requireLink,
            due_date: itemForm.dueDate ? new Date(itemForm.dueDate).toISOString() : null,
            created_by: profile.id,
          })
          .select()
          .single()
        if (assignmentError || !assignment) throw assignmentError ?? new Error('Could not create the assignment.')

        // Classes are org-wide, so target every currently-active member —
        // same one-time-snapshot limitation as every other targeted feature
        // in this app (exam_assignments, invites, coursework): members who
        // join later aren't retroactively added.
        const { data: memberRows } = await supabase.from('memberships').select('user_id').eq('org_id', orgId).eq('status', 'active')
        const targetRows = (memberRows ?? []).map((m) => ({
          assignment_id: assignment.id,
          org_id: orgId,
          assigned_to_user: m.user_id,
        }))
        if (targetRows.length > 0) {
          const { error: targetsError } = await supabase.from('coursework_targets').insert(targetRows)
          if (targetsError) throw targetsError
        }

        const { error: insertError } = await supabase.from('class_module_items').insert({ ...base, coursework_assignment_id: assignment.id })
        if (insertError) throw insertError
      }

      setAddItemModuleId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this item.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteItem(item: ClassModuleItem) {
    if (!confirm(`Remove "${item.title}" from this module?`)) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('class_module_items').delete().eq('id', item.id)
    setBusy(false)
    if (deleteError) setError(deleteError.message)
    else await load()
  }

  const availableResources = resources.filter((r) => r.file_type === itemForm.type)

  return (
    <div className="page">
      <div className="page-head list-header">
        <div>
          {editingInfo ? (
            <form onSubmit={saveInfo} style={{ maxWidth: 420 }}>
              <label>
                Title
                <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} required autoFocus />
              </label>
              <label>
                Description
                <textarea value={descriptionDraft} onChange={(e) => setDescriptionDraft(e.target.value)} rows={2} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" disabled={busy || !titleDraft.trim()}>Save</button>
                <button type="button" className="secondary" onClick={() => setEditingInfo(false)}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <h1>
                {classInfo.title} <span className={`badge ${classInfo.status}`} style={{ marginLeft: 8 }}>{classInfo.status}</span>
              </h1>
              {classInfo.description && <p style={{ color: 'var(--text-dim)' }}>{classInfo.description}</p>}
              <button type="button" className="secondary" onClick={startEditingInfo}>Edit details</button>
            </>
          )}
        </div>

        {!editingInfo && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {classInfo.status !== 'published' && (
              <button type="button" onClick={() => setStatus('published')} disabled={busy}>Publish</button>
            )}
            {classInfo.status === 'published' && (
              <button type="button" className="secondary" onClick={() => setStatus('draft')} disabled={busy}>Unpublish</button>
            )}
            {classInfo.status !== 'archived' && (
              <button type="button" className="secondary" onClick={() => setStatus('archived')} disabled={busy}>Archive</button>
            )}
            <button type="button" className="danger" onClick={deleteClass} disabled={busy}>Delete</button>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="res-card" style={{ marginTop: 16 }}>
        <div className="res-top">
          <div className="res-title-block"><h3>Trainers</h3></div>
          <button type="button" className="secondary" onClick={() => setShowTrainerPicker(true)}>+ Add trainer</button>
        </div>
        {trainers.length === 0 ? (
          <p className="empty-row">No trainer assigned yet — members won't see a "Meet your trainer" section until you add one.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            {trainers.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: '1px solid var(--line)',
                  borderRadius: 20,
                  padding: '6px 12px 6px 6px',
                }}
              >
                {t.profile?.avatar_url ? (
                  <img className="avatar" src={t.profile.avatar_url} alt="" style={{ width: 28, height: 28 }} />
                ) : (
                  <div className="avatar" style={{ width: 28, height: 28 }}>{initials(t.profile?.full_name ?? '?')}</div>
                )}
                <span>{t.profile?.full_name ?? 'Unknown'}</span>
                <button type="button" className="secondary" onClick={() => removeTrainer(t)} disabled={busy}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showTrainerPicker && (
        <div className="modal-backdrop" onClick={() => setShowTrainerPicker(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add a trainer</h2>
            {(() => {
              const trainerIds = new Set(trainers.map((t) => t.user_id))
              const options = members.filter((m) => !trainerIds.has(m.id))
              return options.length === 0 ? (
                <p className="empty-row">
                  Everyone with the Trainer or Admin role is already a trainer on this class — promote another
                  member to Trainer in Members to add them here.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                  {options.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="secondary"
                      style={{ justifyContent: 'flex-start' }}
                      onClick={() => addTrainer(m.id)}
                      disabled={busy}
                    >
                      {m.full_name}
                    </button>
                  ))}
                </div>
              )
            })()}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => setShowTrainerPicker(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        {modules.map((mod) => (
          <div className="res-card" key={mod.id} style={{ marginBottom: 14 }}>
            <div className="res-top">
              <div className="res-left">
                <div className="res-title-block"><h3>{mod.title}</h3></div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="secondary" onClick={() => moveModule(mod, -1)} disabled={busy}>↑</button>
                <button type="button" className="secondary" onClick={() => moveModule(mod, 1)} disabled={busy}>↓</button>
                <button type="button" className="secondary" onClick={() => renameModule(mod)} disabled={busy}>Rename</button>
                <button type="button" className="danger" onClick={() => deleteModule(mod)} disabled={busy}>Delete</button>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {(itemsByModule.get(mod.id) ?? []).length === 0 ? (
                <p className="empty-row">No items yet.</p>
              ) : (
                (itemsByModule.get(mod.id) ?? []).map((item) => (
                  <div key={item.id} className="toggle-row">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {TYPE_ICON[item.type] && <span className="res-icon" style={{ width: 24, height: 24 }}>{TYPE_ICON[item.type]}</span>}
                      <span className="badge">{TYPE_LABEL[item.type]}</span>
                      {item.title}
                    </label>
                    <button type="button" className="secondary" onClick={() => deleteItem(item)} disabled={busy}>Remove</button>
                  </div>
                ))
              )}
              <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={() => openAddItem(mod.id)}>+ Add item</button>
            </div>
          </div>
        ))}

        {showNewModule ? (
          <form onSubmit={addModule} className="res-card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <label style={{ flex: 1, margin: 0 }}>
              Module name
              <input value={moduleTitleDraft} onChange={(e) => setModuleTitleDraft(e.target.value)} required autoFocus placeholder="e.g. Module 1: The Basics" />
            </label>
            <button type="submit" disabled={busy || !moduleTitleDraft.trim()}>Add</button>
            <button type="button" className="secondary" onClick={() => setShowNewModule(false)}>Cancel</button>
          </form>
        ) : (
          <button type="button" onClick={() => setShowNewModule(true)}>+ Add module</button>
        )}
      </div>

      {addItemModuleId && (
        <div className="modal-backdrop" onClick={() => setAddItemModuleId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={addItem}>
              <h2>Add item</h2>
              <label>
                Type
                <select
                  value={itemForm.type}
                  onChange={(e) => {
                    setItemForm((f) => ({ ...BLANK_ITEM_FORM, title: f.title, type: e.target.value as ClassModuleItemType }))
                    resetNewResourceForm()
                  }}
                >
                  {ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </label>
              <label>
                Title
                <input value={itemForm.title} onChange={(e) => setItemForm((f) => ({ ...f, title: e.target.value }))} required autoFocus />
              </label>

              {itemForm.type === 'link' && (
                <label>
                  URL
                  <input
                    type="url"
                    value={itemForm.linkUrl}
                    onChange={(e) => setItemForm((f) => ({ ...f, linkUrl: e.target.value }))}
                    placeholder="https://…"
                    required
                  />
                </label>
              )}

              {(itemForm.type === 'video' || itemForm.type === 'pdf' || itemForm.type === 'podcast') && (
                <>
                  <label>
                    {TYPE_LABEL[itemForm.type]} from your resource library
                    <select value={itemForm.resourceId} onChange={(e) => setItemForm((f) => ({ ...f, resourceId: e.target.value }))} required={!showNewResource}>
                      <option value="">— Select —</option>
                      {availableResources.map((r) => (
                        <option key={r.id} value={r.id}>{r.title}</option>
                      ))}
                    </select>
                  </label>

                  {!showNewResource ? (
                    <button type="button" className="secondary" onClick={() => setShowNewResource(true)}>
                      + Add new {TYPE_LABEL[itemForm.type]}
                    </button>
                  ) : (
                    <div className="res-card">
                      <label>
                        Title
                        <input value={newResourceTitle} onChange={(e) => setNewResourceTitle(e.target.value)} placeholder="e.g. Objection Handling 101" />
                      </label>
                      {itemForm.type === 'pdf' ? (
                        <label>
                          PDF file
                          <button
                            type="button"
                            className={`dropzone ${newResourceDragOver ? 'drag-over' : ''}`}
                            onClick={() => newResourceFileRef.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); setNewResourceDragOver(true) }}
                            onDragLeave={() => setNewResourceDragOver(false)}
                            onDrop={handleNewResourceDrop}
                          >
                            <span className="dropzone-icon">{KIND_ICON.pdf}</span>
                            <span>
                              <div className="dropzone-text">{newResourceFile ? newResourceFile.name : 'Drag a PDF here or click to browse'}</div>
                              <div className="dropzone-hint">PDF only · up to 20MB</div>
                            </span>
                          </button>
                          <input
                            ref={newResourceFileRef}
                            type="file"
                            accept="application/pdf"
                            onChange={(e) => pickNewResourceFile(e.target.files?.[0] ?? null)}
                            style={{ display: 'none' }}
                          />
                        </label>
                      ) : (
                        <label>
                          {TYPE_LABEL[itemForm.type]} link
                          <input
                            type="url"
                            value={newResourceLink}
                            onChange={(e) => setNewResourceLink(e.target.value)}
                            placeholder="https://…"
                          />
                        </label>
                      )}
                      {resourceUploadError && <p className="form-error">{resourceUploadError}</p>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="secondary" onClick={resetNewResourceForm}>Cancel</button>
                        <button type="button" onClick={uploadNewResource} disabled={resourceUploading}>
                          {resourceUploading ? 'Adding…' : 'Add to library'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {itemForm.type === 'article' && (
                <label>
                  Content
                  <textarea value={itemForm.body} onChange={(e) => setItemForm((f) => ({ ...f, body: e.target.value }))} rows={6} required />
                </label>
              )}

              {(itemForm.type === 'test' || itemForm.type === 'quiz') && (
                <label>
                  Exam
                  <select value={itemForm.examId} onChange={(e) => setItemForm((f) => ({ ...f, examId: e.target.value }))} required>
                    <option value="">— Select —</option>
                    {exams.map((ex) => (
                      <option key={ex.id} value={ex.id}>{ex.title}</option>
                    ))}
                  </select>
                  {exams.length === 0 && (
                    <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
                      No published quizzes yet. <Link to="/quizzes">Create and publish one →</Link>, then come back.
                    </p>
                  )}
                </label>
              )}

              {itemForm.type === 'assignment' && (
                <>
                  <label>
                    Instructions
                    <textarea value={itemForm.instructions} onChange={(e) => setItemForm((f) => ({ ...f, instructions: e.target.value }))} rows={4} required />
                  </label>
                  <label>
                    Reference link (optional)
                    <input type="url" value={itemForm.referenceLink} onChange={(e) => setItemForm((f) => ({ ...f, referenceLink: e.target.value }))} />
                  </label>
                  <label>
                    Due date (optional)
                    <input type="date" value={itemForm.dueDate} onChange={(e) => setItemForm((f) => ({ ...f, dueDate: e.target.value }))} />
                  </label>
                  <div className="toggle-row">
                    <label style={{ margin: 0 }}>Require a text note</label>
                    <input type="checkbox" checked={itemForm.requireNote} onChange={(e) => setItemForm((f) => ({ ...f, requireNote: e.target.checked }))} />
                  </div>
                  <div className="toggle-row">
                    <label style={{ margin: 0 }}>Require a link</label>
                    <input type="checkbox" checked={itemForm.requireLink} onChange={(e) => setItemForm((f) => ({ ...f, requireLink: e.target.checked }))} />
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>Sent to every current member of your office automatically.</p>
                </>
              )}

              {error && <p className="form-error">{error}</p>}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy || !itemForm.title.trim()}>{busy ? 'Adding…' : 'Add item'}</button>
                <button type="button" className="secondary" onClick={() => setAddItemModuleId(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
