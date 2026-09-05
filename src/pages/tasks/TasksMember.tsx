import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import type {
  Attempt,
  ClassItemProgress,
  ClassModuleItem,
  CourseworkSubmission,
  Exam,
  TaskFlowStep,
} from '../../types/database'

const DAY_MS = 24 * 60 * 60 * 1000

const TYPE_LABEL = { class: 'Class', exam: 'Exam', assignment: 'Assignment' } as const

interface StepStatus {
  step: TaskFlowStep
  complete: boolean
  completedAt: string | null
}

async function computeClassCompletion(classId: string, userId: string): Promise<{ complete: boolean; completedAt: string | null }> {
  const { data: moduleData } = await supabase.from('class_modules').select('id').eq('class_id', classId)
  const moduleIds = (moduleData ?? []).map((m) => m.id as string)
  if (moduleIds.length === 0) return { complete: true, completedAt: new Date().toISOString() }

  const { data: itemData } = await supabase.from('class_module_items').select('*').in('module_id', moduleIds)
  const items = (itemData as ClassModuleItem[]) ?? []
  if (items.length === 0) return { complete: true, completedAt: new Date().toISOString() }

  const itemIds = items.map((i) => i.id)
  const examIds = items.filter((i) => i.exam_id).map((i) => i.exam_id as string)
  const assignmentIds = items.filter((i) => i.coursework_assignment_id).map((i) => i.coursework_assignment_id as string)

  const [progressRes, attemptsRes, submissionsRes] = await Promise.all([
    supabase.from('class_item_progress').select('*').in('item_id', itemIds).eq('user_id', userId),
    examIds.length > 0
      ? supabase.from('attempts').select('*').in('exam_id', examIds).eq('user_id', userId)
      : Promise.resolve({ data: [] as Attempt[] }),
    assignmentIds.length > 0
      ? supabase.from('coursework_submissions').select('*').in('assignment_id', assignmentIds).eq('user_id', userId)
      : Promise.resolve({ data: [] as CourseworkSubmission[] }),
  ])
  const progress = (progressRes.data as ClassItemProgress[]) ?? []
  const attempts = (attemptsRes.data as Attempt[]) ?? []
  const submissions = (submissionsRes.data as CourseworkSubmission[]) ?? []

  let allDone = true
  let latest: string | null = null
  for (const item of items) {
    let doneAt: string | null = null
    if (item.type === 'video' || item.type === 'pdf' || item.type === 'article') {
      doneAt = progress.find((p) => p.item_id === item.id)?.completed_at ?? null
    } else if (item.type === 'test' || item.type === 'quiz') {
      const passing = attempts.find((a) => a.exam_id === item.exam_id && a.status === 'submitted' && a.passed)
      doneAt = passing?.submitted_at ?? null
    } else {
      const approved = submissions.find((s) => s.assignment_id === item.coursework_assignment_id && s.status === 'approved')
      doneAt = approved?.reviewed_at ?? null
    }
    if (!doneAt) {
      allDone = false
      break
    }
    if (!latest || doneAt > latest) latest = doneAt
  }

  return allDone ? { complete: true, completedAt: latest } : { complete: false, completedAt: null }
}

async function computeExamCompletion(examId: string, userId: string): Promise<{ complete: boolean; completedAt: string | null }> {
  const { data } = await supabase
    .from('attempts')
    .select('*')
    .eq('exam_id', examId)
    .eq('user_id', userId)
    .eq('status', 'submitted')
    .eq('passed', true)
    .order('submitted_at', { ascending: true })
    .limit(1)
  const attempt = (data as Attempt[] | null)?.[0]
  return attempt ? { complete: true, completedAt: attempt.submitted_at } : { complete: false, completedAt: null }
}

async function computeAssignmentCompletion(assignmentId: string, userId: string): Promise<{ complete: boolean; completedAt: string | null }> {
  const { data } = await supabase
    .from('coursework_submissions')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('user_id', userId)
    .maybeSingle()
  const submission = data as CourseworkSubmission | null
  return submission?.status === 'approved' ? { complete: true, completedAt: submission.reviewed_at } : { complete: false, completedAt: null }
}

export default function TasksMember() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id

  const [statuses, setStatuses] = useState<StepStatus[]>([])
  const [examById, setExamById] = useState<Map<string, Exam>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId || !profile) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data: stepData } = await supabase
        .from('task_flow_steps')
        .select('*')
        .eq('org_id', orgId!)
        .order('order_index', { ascending: true })
      const steps = (stepData as TaskFlowStep[]) ?? []

      const examIds = steps.filter((s) => s.type === 'exam' && s.exam_id).map((s) => s.exam_id as string)
      if (examIds.length > 0) {
        const { data: examData } = await supabase.from('exams').select('*').in('id', examIds)
        if (!cancelled) setExamById(new Map(((examData as Exam[]) ?? []).map((e) => [e.id, e])))
      }

      const results: StepStatus[] = []
      for (const step of steps) {
        let result: { complete: boolean; completedAt: string | null }
        if (step.type === 'class' && step.class_id) {
          result = await computeClassCompletion(step.class_id, profile!.id)
        } else if (step.type === 'exam' && step.exam_id) {
          result = await computeExamCompletion(step.exam_id, profile!.id)
        } else if (step.type === 'assignment' && step.coursework_assignment_id) {
          result = await computeAssignmentCompletion(step.coursework_assignment_id, profile!.id)
        } else {
          result = { complete: false, completedAt: null }
        }
        results.push({ step, complete: result.complete, completedAt: result.completedAt })
      }
      if (!cancelled) {
        setStatuses(results)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [orgId, profile])

  if (loading) return <p>Loading…</p>
  if (statuses.length === 0) {
    return <p className="empty-row">Your office hasn't set up a task flow yet — check back soon.</p>
  }

  const available: boolean[] = statuses.map((_, i) => {
    if (i === 0) return true
    const prev = statuses[i - 1]
    if (!prev.complete) return false
    if (!prev.completedAt) return true
    return Date.now() >= new Date(prev.completedAt).getTime() + DAY_MS
  })

  const currentIndex = statuses.findIndex((s) => !s.complete)

  function linkFor(status: StepStatus): { to: string; label: string } | null {
    const { step } = status
    if (step.type === 'class' && step.class_id) return { to: `/training/classes/${step.class_id}`, label: 'Go to class →' }
    if (step.type === 'assignment' && step.coursework_assignment_id) {
      return { to: `/my-assignments/${step.coursework_assignment_id}`, label: 'Go to assignment →' }
    }
    if (step.type === 'exam' && step.exam_id) {
      const exam = examById.get(step.exam_id)
      if (exam?.public_link_enabled) return { to: `/take/${exam.public_token}`, label: 'Take exam →' }
      return null
    }
    return null
  }

  return (
    <div className="page">
      <h1>Tasks</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
        Your office's learning flow — one step unlocks a day after you finish the one before it.
      </p>

      {statuses.map((status, idx) => {
        const { step, complete, completedAt } = status
        const isCurrent = idx === currentIndex
        const isAvailable = available[idx]
        const link = linkFor(status)

        return (
          <div
            className="res-card"
            key={step.id}
            style={{
              marginBottom: 10,
              opacity: complete || (isCurrent && isAvailable) ? 1 : 0.6,
              borderColor: isCurrent && isAvailable ? 'var(--gold)' : undefined,
            }}
          >
            <div className="res-top">
              <div className="res-left">
                <div className="res-title-block">
                  <h3>Day {idx + 1} · {step.title}</h3>
                  <div className="exam-sub">
                    <span className="badge">{TYPE_LABEL[step.type]}</span>
                    {step.description && <> · {step.description}</>}
                  </div>
                </div>
              </div>

              {complete ? (
                <span className="badge active">Done ✓ {completedAt ? new Date(completedAt).toLocaleDateString() : ''}</span>
              ) : isCurrent && isAvailable ? (
                link ? (
                  <Link to={link.to}><button type="button">{link.label}</button></Link>
                ) : (
                  <span className="badge">Not open yet</span>
                )
              ) : isCurrent ? (
                <span className="badge">
                  Unlocks {statuses[idx - 1]?.completedAt
                    ? new Date(new Date(statuses[idx - 1].completedAt!).getTime() + DAY_MS).toLocaleString()
                    : 'soon'}
                </span>
              ) : (
                <span className="badge">Locked</span>
              )}
            </div>
          </div>
        )
      })}

      {currentIndex === -1 && (
        <p className="form-info">You've completed every step in the flow. 🎉</p>
      )}
    </div>
  )
}
