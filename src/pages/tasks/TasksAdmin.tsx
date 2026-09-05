import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import type {
  ClassPurpose,
  CourseworkAssignment,
  Exam,
  SkillClass,
  TaskFlowStep,
  TaskFlowStepType,
} from '../../types/database'

const TYPE_LABEL: Record<TaskFlowStepType, string> = {
  class: 'Class',
  exam: 'Exam',
  assignment: 'Assignment',
}

const PURPOSE_LABEL: Record<ClassPurpose, string> = {
  skill_development: 'Skill Development',
  income_development: 'Income Development',
}

interface StepForm {
  type: TaskFlowStepType
  title: string
  description: string
  classId: string
  examId: string
  assignmentId: string
}

const BLANK_FORM: StepForm = {
  type: 'class',
  title: '',
  description: '',
  classId: '',
  examId: '',
  assignmentId: '',
}

export default function TasksAdmin() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [steps, setSteps] = useState<TaskFlowStep[]>([])
  const [classes, setClasses] = useState<SkillClass[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [assignments, setAssignments] = useState<CourseworkAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showAddStep, setShowAddStep] = useState(false)
  const [form, setForm] = useState<StepForm>(BLANK_FORM)

  async function load(org: string) {
    setLoading(true)
    const [stepsRes, classesRes, examsRes, assignmentsRes] = await Promise.all([
      supabase.from('task_flow_steps').select('*').eq('org_id', org).order('order_index', { ascending: true }),
      supabase.from('classes').select('*').eq('org_id', org).eq('status', 'published').order('title'),
      supabase.from('exams').select('*').eq('org_id', org).eq('status', 'published').order('title'),
      supabase.from('coursework_assignments').select('*').eq('org_id', org).order('title'),
    ])
    setSteps((stepsRes.data as TaskFlowStep[]) ?? [])
    setClasses((classesRes.data as SkillClass[]) ?? [])
    setExams((examsRes.data as Exam[]) ?? [])
    setAssignments((assignmentsRes.data as CourseworkAssignment[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (!orgId) return
    load(orgId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const classById = new Map(classes.map((c) => [c.id, c]))
  const examById = new Map(exams.map((e) => [e.id, e]))
  const assignmentById = new Map(assignments.map((a) => [a.id, a]))

  function linkedTitle(step: TaskFlowStep) {
    if (step.type === 'class') return step.class_id ? (classById.get(step.class_id)?.title ?? 'Deleted class') : '—'
    if (step.type === 'exam') return step.exam_id ? (examById.get(step.exam_id)?.title ?? 'Deleted exam') : '—'
    return step.coursework_assignment_id ? (assignmentById.get(step.coursework_assignment_id)?.title ?? 'Deleted assignment') : '—'
  }

  function openAddStep() {
    setForm(BLANK_FORM)
    setError(null)
    setShowAddStep(true)
  }

  function pickContent(id: string) {
    if (form.type === 'class') {
      const c = classById.get(id)
      setForm((f) => ({ ...f, classId: id, title: f.title || c?.title || '' }))
    } else if (form.type === 'exam') {
      const e = examById.get(id)
      setForm((f) => ({ ...f, examId: id, title: f.title || e?.title || '' }))
    } else {
      const a = assignmentById.get(id)
      setForm((f) => ({ ...f, assignmentId: id, title: f.title || a?.title || '' }))
    }
  }

  // An assignment picked here may have been created (and targeted) long
  // before it became a task step, and Tasks is a shared flow every member
  // walks — so any active member not already targeted gets backfilled,
  // same "org-wide" auto-targeting ClassEditor does for a brand-new
  // assignment item. Classes/exams need no equivalent step: a published
  // class is already visible org-wide, and exam steps link to the public
  // take-exam flow, neither gated by per-member targeting.
  async function backfillAssignmentTargets(org: string, assignmentId: string) {
    const [{ data: memberRows }, { data: targetRows }] = await Promise.all([
      supabase.from('memberships').select('user_id').eq('org_id', org).eq('status', 'active'),
      supabase.from('coursework_targets').select('assigned_to_user').eq('assignment_id', assignmentId),
    ])
    const alreadyTargeted = new Set((targetRows ?? []).map((t) => t.assigned_to_user))
    const missing = (memberRows ?? []).map((m) => m.user_id).filter((id) => !alreadyTargeted.has(id))
    if (missing.length === 0) return
    await supabase.from('coursework_targets').insert(
      missing.map((userId) => ({ assignment_id: assignmentId, org_id: org, assigned_to_user: userId }))
    )
  }

  async function addStep(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !form.title.trim()) return
    const contentId = form.type === 'class' ? form.classId : form.type === 'exam' ? form.examId : form.assignmentId
    if (!contentId) {
      setError(`Pick ${form.type === 'class' ? 'a class' : form.type === 'exam' ? 'an exam' : 'an assignment'} to link.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { error: insertError } = await supabase.from('task_flow_steps').insert({
        org_id: orgId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        order_index: steps.length,
        type: form.type,
        class_id: form.type === 'class' ? contentId : null,
        exam_id: form.type === 'exam' ? contentId : null,
        coursework_assignment_id: form.type === 'assignment' ? contentId : null,
        created_by: profile.id,
      })
      if (insertError) throw insertError
      if (form.type === 'assignment') await backfillAssignmentTargets(orgId, contentId)
      setShowAddStep(false)
      await load(orgId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this step.')
    } finally {
      setBusy(false)
    }
  }

  async function moveStep(step: TaskFlowStep, direction: -1 | 1) {
    const sorted = [...steps].sort((a, b) => a.order_index - b.order_index)
    const idx = sorted.findIndex((s) => s.id === step.id)
    const swapWith = sorted[idx + direction]
    if (!swapWith || !orgId) return
    setBusy(true)
    await Promise.all([
      supabase.from('task_flow_steps').update({ order_index: swapWith.order_index }).eq('id', step.id),
      supabase.from('task_flow_steps').update({ order_index: step.order_index }).eq('id', swapWith.id),
    ])
    setBusy(false)
    await load(orgId)
  }

  async function deleteStep(step: TaskFlowStep) {
    if (!orgId) return
    if (!confirm(`Remove "${step.title}" from the flow? Members' progress on it isn't lost — it's derived from their exam/assignment/class completion, not stored here.`)) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('task_flow_steps').delete().eq('id', step.id)
    setBusy(false)
    if (deleteError) setError(deleteError.message)
    else await load(orgId)
  }

  if (loading) return <div className="page"><p>Loading…</p></div>

  return (
    <div className="page">
      <div className="page-head list-header">
        <div>
          <h1>Tasks</h1>
          <p style={{ color: 'var(--text-dim)', margin: 0 }}>
            One ordered flow every member walks through, a step a day — each step links to a class, exam, or
            assignment that already exists in your Learning Center.
          </p>
        </div>
        <button type="button" onClick={openAddStep}>+ Add step</button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {steps.length === 0 ? (
        <p className="empty-row" style={{ marginTop: 16 }}>No steps yet — add one to start the flow.</p>
      ) : (
        <div style={{ marginTop: 16 }}>
          {[...steps].sort((a, b) => a.order_index - b.order_index).map((step, idx) => (
            <div className="res-card" key={step.id} style={{ marginBottom: 10 }}>
              <div className="res-top">
                <div className="res-left">
                  <div className="res-title-block">
                    <h3>Day {idx + 1} · {step.title}</h3>
                    <div className="exam-sub">
                      <span className="badge">{TYPE_LABEL[step.type]}</span>{' '}
                      {linkedTitle(step)}
                      {step.type === 'class' && step.class_id && classById.get(step.class_id) && (
                        <> · {PURPOSE_LABEL[classById.get(step.class_id)!.purpose]}</>
                      )}
                    </div>
                    {step.description && <p style={{ color: 'var(--text-dim)', margin: '4px 0 0' }}>{step.description}</p>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="secondary" onClick={() => moveStep(step, -1)} disabled={busy || idx === 0}>↑</button>
                  <button type="button" className="secondary" onClick={() => moveStep(step, 1)} disabled={busy || idx === steps.length - 1}>↓</button>
                  <button type="button" className="danger" onClick={() => deleteStep(step)} disabled={busy}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddStep && (
        <div className="modal-backdrop" onClick={() => setShowAddStep(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={addStep}>
              <h2>Add a step</h2>
              <label>
                Type
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...BLANK_FORM, type: e.target.value as TaskFlowStepType })}
                >
                  {(Object.keys(TYPE_LABEL) as TaskFlowStepType[]).map((t) => (
                    <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </label>

              {form.type === 'class' && (
                <label>
                  Class
                  <select value={form.classId} onChange={(e) => pickContent(e.target.value)} required>
                    <option value="">— Select —</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.title} ({PURPOSE_LABEL[c.purpose]})</option>
                    ))}
                  </select>
                  {classes.length === 0 && (
                    <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>No published classes yet — publish one in Training first.</p>
                  )}
                </label>
              )}

              {form.type === 'exam' && (
                <label>
                  Exam
                  <select value={form.examId} onChange={(e) => pickContent(e.target.value)} required>
                    <option value="">— Select —</option>
                    {exams.map((ex) => <option key={ex.id} value={ex.id}>{ex.title}</option>)}
                  </select>
                  {exams.length === 0 && (
                    <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>No published exams yet — publish one in Exams first.</p>
                  )}
                </label>
              )}

              {form.type === 'assignment' && (
                <label>
                  Assignment
                  <select value={form.assignmentId} onChange={(e) => pickContent(e.target.value)} required>
                    <option value="">— Select —</option>
                    {assignments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                  </select>
                  {assignments.length === 0 && (
                    <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>No assignments yet — create one in Assignments first.</p>
                  )}
                </label>
              )}

              <label>
                Title shown to members
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
              </label>
              <label>
                Description (optional)
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
              </label>

              {error && <p className="form-error">{error}</p>}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy || !form.title.trim()}>{busy ? 'Adding…' : 'Add step'}</button>
                <button type="button" className="secondary" onClick={() => setShowAddStep(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
