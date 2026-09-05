// Single source of truth for "what's the current state of this
// exam/assignment for this person" — used by TakeExam.tsx, MyExams.tsx,
// Dashboard.tsx, and ExamRoster.tsx so the reconciliation rule for stale
// or missed attempts lives in exactly one place.
//
// There's no scheduled job (cron) doing this sweep. Instead, whenever a
// relevant page loads, it calls one of the heal* functions below, which
// lazily write the failure into `attempts` the first time anyone looks —
// self-healing on read rather than on a timer. This keeps status accurate
// within moments of anyone opening a relevant page, without any new
// infrastructure to maintain.
import { supabase } from './supabase'
import type { Attempt, ExamAssignment, ExamSettings } from '../types/database'

export type EffectiveStatus = 'too_early' | 'not_started' | 'in_progress' | 'passed' | 'failed' | 'missed'

export interface EffectiveResult {
  status: EffectiveStatus
  attempt: Attempt | null
}

/** Pure, synchronous — safe to call on every render before any write completes. */
export function getEffectiveStatus(
  assignment: Pick<ExamAssignment, 'starts_at' | 'ends_at'> | null,
  attempts: Attempt[],
  now: number = Date.now()
): EffectiveResult {
  if (assignment?.starts_at && now < new Date(assignment.starts_at).getTime()) {
    return { status: 'too_early', attempt: null }
  }

  const inProgress = attempts.find((a) => a.status === 'in_progress')
  if (inProgress) return { status: 'in_progress', attempt: inProgress }

  const resolved = attempts
    .filter((a) => a.status === 'submitted' || a.status === 'expired')
    .sort((a, b) => (b.attempt_number ?? 0) - (a.attempt_number ?? 0))[0]
  if (resolved) {
    if (resolved.status === 'expired') return { status: 'missed', attempt: resolved }
    return { status: resolved.passed ? 'passed' : 'failed', attempt: resolved }
  }

  if (assignment?.ends_at && now > new Date(assignment.ends_at).getTime()) {
    return { status: 'missed', attempt: null }
  }

  return { status: 'not_started', attempt: null }
}

/** Async write. Idempotent via the trailing status filter — a concurrent call is a no-op. */
export async function reconcileStaleAttempt(
  attempt: Attempt,
  timeLimitMinutes: number,
  assignmentEndsAt: string | null
) {
  if (attempt.status !== 'in_progress') return
  const startedMs = new Date(attempt.started_at).getTime()
  const limitDeadline = startedMs + timeLimitMinutes * 60 * 1000
  const windowDeadline = assignmentEndsAt ? new Date(assignmentEndsAt).getTime() : Infinity
  const deadline = Math.min(limitDeadline, windowDeadline)
  if (Date.now() <= deadline) return

  await supabase
    .from('attempts')
    .update({
      status: 'expired',
      passed: false,
      submitted_at: new Date(deadline).toISOString(),
      time_spent_seconds: Math.round((deadline - startedMs) / 1000),
    })
    .eq('id', attempt.id)
    .eq('status', 'in_progress')
}

/** Async write. Inserts a "missed" attempt row if a scheduled window elapsed with nothing ever started. */
async function reconcileMissedAssignment(
  assignment: Pick<ExamAssignment, 'ends_at'>,
  examId: string,
  orgId: string,
  userId: string,
  priorAttempts: Attempt[]
) {
  if (!assignment.ends_at || priorAttempts.length > 0) return
  const endsAtMs = new Date(assignment.ends_at).getTime()
  if (Date.now() <= endsAtMs) return

  const { error } = await supabase.from('attempts').insert({
    org_id: orgId,
    exam_id: examId,
    user_id: userId,
    is_guest: false,
    attempt_number: 1,
    started_at: assignment.ends_at,
    submitted_at: assignment.ends_at,
    status: 'expired',
    passed: false,
    time_spent_seconds: 0,
  })
  // 23505 = someone else's concurrent heal pass already inserted this row.
  if (error && error.code !== '23505') throw error
}

interface AssignmentWithExam extends ExamAssignment {
  exam_id: string
}

/** Self case: reconciles the current user's own in-progress/missed exams within one org. */
export async function healUserAttempts(orgId: string, userId: string) {
  const { data: myGroups } = await supabase.from('group_members').select('group_id').eq('user_id', userId)
  const groupIds = (myGroups ?? []).map((g) => g.group_id)

  const [directRes, groupRes, inProgressRes] = await Promise.all([
    supabase.from('exam_assignments').select('*').eq('org_id', orgId).eq('assigned_to_user', userId),
    groupIds.length > 0
      ? supabase.from('exam_assignments').select('*').eq('org_id', orgId).in('assigned_to_group', groupIds)
      : Promise.resolve({ data: [] as AssignmentWithExam[] }),
    supabase.from('attempts').select('exam_id').eq('org_id', orgId).eq('user_id', userId).eq('status', 'in_progress'),
  ])

  const assignments = [...((directRes.data as AssignmentWithExam[]) ?? []), ...((groupRes.data as AssignmentWithExam[]) ?? [])]
  const assignmentByExam = new Map(assignments.map((a) => [a.exam_id, a]))
  const examIds = new Set<string>([...assignmentByExam.keys(), ...((inProgressRes.data ?? []).map((a) => a.exam_id))])
  if (examIds.size === 0) return

  const [settingsRes, attemptsRes] = await Promise.all([
    supabase.from('exam_settings').select('*').in('exam_id', [...examIds]),
    supabase.from('attempts').select('*').eq('org_id', orgId).eq('user_id', userId).in('exam_id', [...examIds]),
  ])
  const settingsByExam = new Map((settingsRes.data as ExamSettings[] | null)?.map((s) => [s.exam_id, s]))
  const attemptsByExam = new Map<string, Attempt[]>()
  for (const a of (attemptsRes.data as Attempt[]) ?? []) {
    const list = attemptsByExam.get(a.exam_id) ?? []
    list.push(a)
    attemptsByExam.set(a.exam_id, list)
  }

  await Promise.all(
    [...examIds].map(async (examId) => {
      const assignment = assignmentByExam.get(examId) ?? null
      const settings = settingsByExam.get(examId)
      const examAttempts = attemptsByExam.get(examId) ?? []

      const inProgress = examAttempts.find((a) => a.status === 'in_progress')
      if (inProgress && settings) {
        await reconcileStaleAttempt(inProgress, settings.time_limit_minutes, assignment?.ends_at ?? null)
      }
      if (assignment) {
        await reconcileMissedAssignment(assignment, examId, orgId, userId, examAttempts)
      }
    })
  )
}

/** Admin case: reconciles every assigned member's status for one exam (used by the roster view). */
export async function healOrgExamAttempts(orgId: string, examId: string) {
  const { data: assignments } = await supabase
    .from('exam_assignments')
    .select('*')
    .eq('org_id', orgId)
    .eq('exam_id', examId)

  const rows = (assignments as ExamAssignment[]) ?? []
  const groupIds = rows.filter((a) => a.assigned_to_group).map((a) => a.assigned_to_group!)

  const groupMembersRes =
    groupIds.length > 0
      ? await supabase.from('group_members').select('group_id, user_id').in('group_id', groupIds)
      : { data: [] as { group_id: string; user_id: string }[] }

  const assignmentByUser = new Map<string, ExamAssignment>()
  for (const a of rows) {
    if (a.assigned_to_user && !assignmentByUser.has(a.assigned_to_user)) assignmentByUser.set(a.assigned_to_user, a)
  }
  for (const gm of groupMembersRes.data ?? []) {
    if (assignmentByUser.has(gm.user_id)) continue
    const assignment = rows.find((a) => a.assigned_to_group === gm.group_id)
    if (assignment) assignmentByUser.set(gm.user_id, assignment)
  }

  const memberIds = [...assignmentByUser.keys()]
  if (memberIds.length === 0) return

  const [settingsRes, attemptsRes] = await Promise.all([
    supabase.from('exam_settings').select('*').eq('exam_id', examId).maybeSingle(),
    supabase.from('attempts').select('*').eq('org_id', orgId).eq('exam_id', examId).in('user_id', memberIds),
  ])
  const settings = settingsRes.data as ExamSettings | null
  const attemptsByUser = new Map<string, Attempt[]>()
  for (const a of (attemptsRes.data as Attempt[]) ?? []) {
    if (!a.user_id) continue
    const list = attemptsByUser.get(a.user_id) ?? []
    list.push(a)
    attemptsByUser.set(a.user_id, list)
  }

  await Promise.all(
    memberIds.map(async (userId) => {
      const assignment = assignmentByUser.get(userId)!
      const userAttempts = attemptsByUser.get(userId) ?? []
      const inProgress = userAttempts.find((a) => a.status === 'in_progress')
      if (inProgress && settings) {
        await reconcileStaleAttempt(inProgress, settings.time_limit_minutes, assignment.ends_at)
      }
      await reconcileMissedAssignment(assignment, examId, orgId, userId, userAttempts)
    })
  )
}
