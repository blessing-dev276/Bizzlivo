// Live completion checks for a single piece of Learning Center content.
// Nothing is stored — completion is read from whatever signal that content
// type already tracks (class_item_progress + attempts + coursework_submissions
// for a class, attempts for an exam, coursework_submissions for an
// assignment). Consumed by Business Path (src/lib/businessPath.ts).
import { supabase } from './supabase'
import type {
  Attempt,
  ClassItemProgress,
  ClassModuleItem,
  CourseworkSubmission,
} from '../types/database'

export async function computeClassCompletion(
  classId: string,
  userId: string,
): Promise<{ complete: boolean; completedAt: string | null }> {
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

export async function computeExamCompletion(
  examId: string,
  userId: string,
): Promise<{ complete: boolean; completedAt: string | null }> {
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

export async function computeAssignmentCompletion(
  assignmentId: string,
  userId: string,
): Promise<{ complete: boolean; completedAt: string | null }> {
  const { data } = await supabase
    .from('coursework_submissions')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('user_id', userId)
    .maybeSingle()
  const submission = data as CourseworkSubmission | null
  return submission?.status === 'approved'
    ? { complete: true, completedAt: submission.reviewed_at }
    : { complete: false, completedAt: null }
}
