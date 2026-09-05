import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { createResource, MAX_PDF_BYTES } from '../../lib/createResource'
import { KIND_ICON } from '../../lib/resourceKind'
import { getTrainerExamIds } from '../../lib/trainerScope'
import type { Exam, ExamStatus, Question, QuestionOption, Resource } from '../../types/database'

type ResourceMode = 'none' | 'existing' | 'upload'

type FilterTab = 'all' | ExamStatus

interface ExamRow extends Exam {
  resourceTitle: string | null
  approvedCount: number
  pendingCount: number
  rejectedCount: number
  timeLimitMinutes: number | null
  passMarkPercent: number | null
  attemptsCount: number
  passRate: number | null
}

export default function Exams() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const role = currentMembership?.role
  const navigate = useNavigate()

  const [rows, setRows] = useState<ExamRow[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [title, setTitle] = useState('')
  const [resourceMode, setResourceMode] = useState<ResourceMode>('none')
  const [resourceId, setResourceId] = useState('')
  const [newResourceFile, setNewResourceFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [filter, setFilter] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function load() {
    if (!orgId) return
    const [{ data: examData }, { data: resourceData }] = await Promise.all([
      supabase.from('exams').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
      supabase.from('resources').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
    ])
    let exams = (examData as Exam[]) ?? []
    // Trainers manage exams org-wide by RLS, but only see the ones placed
    // inside a class they're attached to — not every exam in the office.
    if (role === 'trainer' && profile) {
      const allowedExamIds = await getTrainerExamIds(profile.id)
      exams = exams.filter((e) => allowedExamIds.has(e.id))
    }
    const resourceList = (resourceData as Resource[]) ?? []
    setResources(resourceList)

    const examIds = exams.map((e) => e.id)
    const [{ data: questionData }, { data: settingsData }, { data: attemptData }] = await Promise.all([
      supabase.from('questions').select('exam_id, status').eq('org_id', orgId),
      examIds.length > 0
        ? supabase.from('exam_settings').select('exam_id, time_limit_minutes, pass_mark_percent').in('exam_id', examIds)
        : Promise.resolve({ data: [] }),
      supabase.from('attempts').select('exam_id, passed').eq('org_id', orgId).eq('status', 'submitted'),
    ])

    const resourceMap = new Map(resourceList.map((r) => [r.id, r.title]))
    const settingsMap = new Map((settingsData ?? []).map((s) => [s.exam_id, s]))

    const questionCounts = new Map<string, { approved: number; pending_review: number; rejected: number }>()
    for (const q of (questionData as { exam_id: string; status: string }[]) ?? []) {
      const counts = questionCounts.get(q.exam_id) ?? { approved: 0, pending_review: 0, rejected: 0 }
      if (q.status === 'approved' || q.status === 'pending_review' || q.status === 'rejected') {
        counts[q.status] += 1
      }
      questionCounts.set(q.exam_id, counts)
    }

    const attemptStats = new Map<string, { count: number; passed: number }>()
    for (const a of (attemptData as { exam_id: string; passed: boolean | null }[]) ?? []) {
      const stats = attemptStats.get(a.exam_id) ?? { count: 0, passed: 0 }
      stats.count += 1
      if (a.passed) stats.passed += 1
      attemptStats.set(a.exam_id, stats)
    }

    const nextRows: ExamRow[] = exams.map((exam) => {
      const counts = questionCounts.get(exam.id) ?? { approved: 0, pending_review: 0, rejected: 0 }
      const settings = settingsMap.get(exam.id)
      const stats = attemptStats.get(exam.id)
      return {
        ...exam,
        resourceTitle: exam.resource_id ? resourceMap.get(exam.resource_id) ?? null : null,
        approvedCount: counts.approved,
        pendingCount: counts.pending_review,
        rejectedCount: counts.rejected,
        timeLimitMinutes: settings?.time_limit_minutes ?? null,
        passMarkPercent: settings?.pass_mark_percent ?? null,
        attemptsCount: stats?.count ?? 0,
        passRate: stats && stats.count > 0 ? Math.round((stats.passed / stats.count) * 100) : null,
      }
    })

    setRows(nextRows)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const counts = useMemo(
    () => ({
      all: rows.length,
      draft: rows.filter((r) => r.status === 'draft').length,
      published: rows.filter((r) => r.status === 'published').length,
      archived: rows.filter((r) => r.status === 'archived').length,
    }),
    [rows]
  )

  const visible = useMemo(() => {
    return rows
      .filter((r) => filter === 'all' || r.status === filter)
      .filter((r) => r.title.toLowerCase().includes(search.trim().toLowerCase()))
  }, [rows, filter, search])

  // One exam per resource — a resource already claimed by an exam shouldn't
  // be offered again; the office should add more questions to that exam instead.
  const claimedResourceIds = useMemo(() => new Set(rows.filter((r) => r.resource_id).map((r) => r.resource_id as string)), [rows])
  const availableResources = useMemo(() => resources.filter((r) => !claimedResourceIds.has(r.id)), [resources, claimedResourceIds])

  function resetNewExamForm() {
    setTitle('')
    setResourceMode('none')
    setResourceId('')
    setNewResourceFile(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function pickFile(f: File | null) {
    setError(null)
    if (!f) {
      setNewResourceFile(null)
      return
    }
    if (f.type !== 'application/pdf') {
      setError('Only PDF files are supported.')
      return
    }
    if (f.size > MAX_PDF_BYTES) {
      setError('File is too large — the limit is 20MB.')
      return
    }
    setNewResourceFile(f)
  }

  function handleDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setDragOver(false)
    pickFile(e.dataTransfer.files?.[0] ?? null)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile) return
    if (resourceMode === 'upload' && !newResourceFile) {
      setError('Choose a PDF file.')
      return
    }
    setError(null)
    setCreating(true)

    try {
      let finalResourceId: string | null = null
      if (resourceMode === 'existing') {
        finalResourceId = resourceId || null
      } else if (resourceMode === 'upload' && newResourceFile) {
        const uploaded = await createResource({
          orgId,
          uploadedBy: profile.id,
          title: title.trim(),
          kind: 'pdf',
          purpose: 'skill_set',
          file: newResourceFile,
        })
        finalResourceId = uploaded.id
      }

      const { data: exam, error: examError } = await supabase
        .from('exams')
        .insert({
          org_id: orgId,
          resource_id: finalResourceId,
          title,
          created_by: profile.id,
          status: 'draft',
        })
        .select()
        .single()
      if (examError) {
        if (examError.code === '23505') throw new Error('This resource already has an exam — add more questions to that exam instead of creating a new one.')
        throw examError
      }

      const { error: settingsError } = await supabase.from('exam_settings').insert({
        exam_id: exam.id,
      })
      if (settingsError) throw settingsError

      navigate(`/exams/${exam.id}/generate`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create exam.')
      setCreating(false)
    }
  }

  function copyLink(exam: ExamRow) {
    navigator.clipboard.writeText(`${window.location.origin}/take/${exam.public_token}`)
    setCopiedId(exam.id)
    setTimeout(() => setCopiedId((id) => (id === exam.id ? null : id)), 1500)
  }

  async function duplicateExam(exam: ExamRow) {
    if (!orgId || !profile || actingId) return
    setOpenMenuId(null)
    setActionError(null)
    setActingId(exam.id)
    try {
      const [{ data: settings }, { data: questions }] = await Promise.all([
        supabase.from('exam_settings').select('*').eq('exam_id', exam.id).single(),
        supabase.from('questions').select('*, question_options(*)').eq('exam_id', exam.id),
      ])

      // resource_id isn't copied — one exam per resource, and the original
      // already holds that slot. The duplicate becomes a standalone/manual exam.
      const { data: newExam, error: examError } = await supabase
        .from('exams')
        .insert({
          org_id: orgId,
          resource_id: null,
          title: `${exam.title} (copy)`,
          created_by: profile.id,
          status: 'draft',
        })
        .select()
        .single()
      if (examError || !newExam) throw examError ?? new Error('Could not duplicate exam.')

      await supabase.from('exam_settings').insert({
        exam_id: newExam.id,
        num_questions: settings?.num_questions ?? 10,
        question_pool_size: settings?.question_pool_size ?? null,
        time_limit_minutes: settings?.time_limit_minutes ?? 20,
        shuffle_questions: settings?.shuffle_questions ?? true,
        shuffle_options: settings?.shuffle_options ?? true,
        pass_mark_percent: settings?.pass_mark_percent ?? 70,
        max_attempts: settings?.max_attempts ?? 1,
        require_fullscreen: settings?.require_fullscreen ?? false,
        flag_tab_switch: settings?.flag_tab_switch ?? false,
      })

      for (const q of (questions as (Question & { question_options: QuestionOption[] })[]) ?? []) {
        const { data: newQuestion, error: qError } = await supabase
          .from('questions')
          .insert({
            exam_id: newExam.id,
            org_id: orgId,
            type: q.type,
            text: q.text,
            skill_tag: q.skill_tag,
            difficulty: q.difficulty,
            order_index: q.order_index,
            ai_generated: q.ai_generated,
            status: q.status,
          })
          .select()
          .single()
        if (qError || !newQuestion) continue

        const optionRows = q.question_options.map((o) => ({
          question_id: newQuestion.id,
          text: o.text,
          is_correct: o.is_correct,
          order_index: o.order_index,
        }))
        if (optionRows.length > 0) await supabase.from('question_options').insert(optionRows)
      }

      await load()
      navigate(`/exams/${newExam.id}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not duplicate exam.')
      setActingId(null)
    }
  }

  async function toggleArchive(exam: ExamRow) {
    if (actingId) return
    setOpenMenuId(null)
    setActionError(null)
    setActingId(exam.id)
    const nextStatus: ExamStatus = exam.status === 'archived' ? 'draft' : 'archived'
    const { error: updateError } = await supabase.from('exams').update({ status: nextStatus }).eq('id', exam.id)
    if (updateError) setActionError(updateError.message)
    await load()
    setActingId(null)
  }

  async function deleteExam(exam: ExamRow) {
    if (actingId) return
    setOpenMenuId(null)
    if (!confirm(`Delete "${exam.title}" permanently? This removes its questions, settings, and all attempt history — this can't be undone.`)) return
    setActionError(null)
    setActingId(exam.id)
    const { error: deleteError } = await supabase.from('exams').delete().eq('id', exam.id)
    if (deleteError) setActionError(deleteError.message)
    await load()
    setActingId(null)
  }

  return (
    <div className="page">
      <div className="page-head list-header">
        <h1>Exams</h1>
        <button onClick={() => { resetNewExamForm(); setShowNew(true) }}>+ New exam</button>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}

      <div className="toolbar">
        <div className="chips">
          <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All · {counts.all}</button>
          <button className={`chip ${filter === 'draft' ? 'active' : ''}`} onClick={() => setFilter('draft')}>Draft · {counts.draft}</button>
          <button className={`chip ${filter === 'published' ? 'active' : ''}`} onClick={() => setFilter('published')}>Published · {counts.published}</button>
          <button className={`chip ${filter === 'archived' ? 'active' : ''}`} onClick={() => setFilter('archived')}>Archived · {counts.archived}</button>
        </div>
        <div className="search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
          <input type="text" placeholder="Search exams..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {showNew && (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleCreate}>
              <h2>New exam</h2>
              <label>
                Exam title
                <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="e.g. Objection Handling Assessment" />
              </label>
              <label>
                Source resource (optional)
                <div className="cycle-toggle" style={{ marginTop: 4, marginBottom: resourceMode === 'none' ? 0 : 10 }}>
                  <button type="button" className={resourceMode === 'none' ? 'active' : ''} onClick={() => { setResourceMode('none'); setResourceId(''); setNewResourceFile(null); setError(null) }}>
                    None
                  </button>
                  <button type="button" className={resourceMode === 'existing' ? 'active' : ''} onClick={() => { setResourceMode('existing'); setNewResourceFile(null); setError(null) }}>
                    Existing
                  </button>
                  <button type="button" className={resourceMode === 'upload' ? 'active' : ''} onClick={() => { setResourceMode('upload'); setResourceId(''); setError(null) }}>
                    Upload PDF
                  </button>
                </div>
              </label>
              {resourceMode === 'existing' && (
                <label>
                  Resource
                  <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} required>
                    <option value="">— Select —</option>
                    {availableResources.map((r) => (
                      <option key={r.id} value={r.id}>{r.title}</option>
                    ))}
                  </select>
                  {resources.length > availableResources.length && (
                    <p style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 6 }}>
                      Resources that already have an exam aren't listed — add more questions to that exam instead.
                    </p>
                  )}
                </label>
              )}
              {resourceMode === 'upload' && (
                <label>
                  PDF file
                  <button
                    type="button"
                    className={`dropzone ${dragOver ? 'drag-over' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                  >
                    <span className="dropzone-icon">{KIND_ICON.pdf}</span>
                    <span>
                      <div className="dropzone-text">{newResourceFile ? newResourceFile.name : 'Drag a PDF here or click to browse'}</div>
                      <div className="dropzone-hint">PDF only · up to 20MB</div>
                    </span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                    style={{ display: 'none' }}
                  />
                </label>
              )}
              {error && <p className="form-error">{error}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="secondary" onClick={() => setShowNew(false)}>Cancel</button>
                <button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create exam'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : visible.length === 0 ? (
        <p>{rows.length === 0 ? 'No exams yet.' : 'No exams match this view.'}</p>
      ) : (
        <div className="exam-list">
          {visible.map((exam) => (
            <div className="exam-card" key={exam.id}>
              <div className="exam-top">
                <div className="exam-title-block">
                  <h3><Link to={`/exams/${exam.id}`}>{exam.title}</Link></h3>
                  <div className="exam-sub">
                    {exam.resourceTitle ? `From "${exam.resourceTitle}" · ` : ''}
                    created {new Date(exam.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="exam-top-right">
                  <span className={`status-pill status-${exam.status}`}>{exam.status}</span>
                  <div className="kebab-wrap">
                    <button
                      type="button"
                      className="kebab"
                      onClick={() => setOpenMenuId((id) => (id === exam.id ? null : exam.id))}
                      disabled={actingId === exam.id}
                      aria-label="Exam actions"
                    >
                      <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="19" r="1.2" /></svg>
                    </button>
                    {openMenuId === exam.id && (
                      <>
                        <div
                          style={{ position: 'fixed', inset: 0, zIndex: 10 }}
                          onClick={() => setOpenMenuId(null)}
                        />
                        <div className="kebab-menu">
                          <button type="button" onClick={() => duplicateExam(exam)}>Duplicate</button>
                          <button type="button" onClick={() => toggleArchive(exam)}>
                            {exam.status === 'archived' ? 'Unarchive' : 'Archive'}
                          </button>
                          <button type="button" className="danger-item" onClick={() => deleteExam(exam)}>Delete</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="exam-meta">
                <div className="meta-item">
                  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>
                  <span className="meta-strong">{exam.approvedCount}</span>&nbsp;{exam.status === 'draft' ? 'approved' : 'questions'}
                </div>

                {exam.pendingCount > 0 && (
                  <>
                    <span className="meta-div" />
                    <div className="warn-pill">
                      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></svg>
                      {exam.pendingCount} pending review
                    </div>
                    <span className="meta-div" />
                    <Link to={`/exams/${exam.id}/review`} className="review-cta">Review now →</Link>
                  </>
                )}

                {exam.status === 'published' && (
                  <>
                    <span className="meta-div" />
                    <div className="meta-item">
                      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
                      {exam.timeLimitMinutes ?? '—'}m limit
                    </div>
                    <span className="meta-div" />
                    <div className="meta-item">
                      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 2.5" /></svg>
                      {exam.passMarkPercent ?? '—'}% pass mark
                    </div>
                    <span className="meta-div" />
                    <div className="meta-item">
                      <svg viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></svg>
                      <span className="meta-strong">{exam.attemptsCount}</span>&nbsp;attempts
                      {exam.passRate !== null && <> · {exam.passRate}% pass</>}
                    </div>
                    <span className="meta-div" />
                    {exam.public_link_enabled ? (
                      <div className="meta-item">
                        <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                        <span className="link-on">Public link on</span>
                        <button type="button" className="copy-btn" onClick={() => copyLink(exam)} title="Copy link">
                          {copiedId === exam.id ? (
                            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>
                          ) : (
                            <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="meta-item">
                        <svg viewBox="0 0 24 24"><path d="M17 17l-5-5m0 0l-5-5m5 5l5-5m-5 5l-5 5" /></svg>
                        <span className="link-off">Public link off</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
