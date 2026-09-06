import { useEffect, useState } from 'react'
import { PageSkeleton } from '../../components/AppSkeleton'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { getEffectiveStatus, healUserAttempts } from '../../lib/examLifecycle'
import type { Attempt, Exam, ExamAssignment, ExamSettings } from '../../types/database'

interface AssignmentRow extends ExamAssignment {
  exam: Exam
}

interface ExamRowState {
  assignment: AssignmentRow
  settings: ExamSettings | null
  attempts: Attempt[]
}

export default function MyExams() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const [rows, setRows] = useState<ExamRowState[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile || !orgId) return
    let cancelled = false

    async function load() {
      const { data: myGroups } = await supabase.from('group_members').select('group_id').eq('user_id', profile!.id)
      const groupIds = (myGroups ?? []).map((g) => g.group_id)

      const [directRes, groupRes] = await Promise.all([
        supabase.from('exam_assignments').select('*, exam:exams(*)').eq('assigned_to_user', profile!.id),
        groupIds.length > 0
          ? supabase.from('exam_assignments').select('*, exam:exams(*)').in('assigned_to_group', groupIds)
          : Promise.resolve({ data: [] as AssignmentRow[] }),
      ])

      const combined = [...((directRes.data as AssignmentRow[]) ?? []), ...((groupRes.data as AssignmentRow[]) ?? [])]
      const uniqueByExam = new Map<string, AssignmentRow>()
      for (const a of combined) {
        if (!uniqueByExam.has(a.exam_id) && a.exam?.status === 'published') uniqueByExam.set(a.exam_id, a)
      }
      const assignments = [...uniqueByExam.values()]

      const examIds = assignments.map((a) => a.exam_id)
      if (examIds.length === 0) {
        if (!cancelled) {
          setRows([])
          setLoading(false)
        }
        return
      }

      // Reconcile any stale in-progress attempt or missed scheduled window
      // before reading, so an abandoned/expired exam shows up correctly.
      await healUserAttempts(orgId!, profile!.id)

      const [settingsRes, attemptsRes] = await Promise.all([
        supabase.from('exam_settings').select('*').in('exam_id', examIds),
        supabase.from('attempts').select('*').eq('user_id', profile!.id).in('exam_id', examIds),
      ])
      const settingsByExam = new Map((settingsRes.data as ExamSettings[])?.map((s) => [s.exam_id, s]))
      const attemptsByExam = new Map<string, Attempt[]>()
      for (const at of (attemptsRes.data as Attempt[]) ?? []) {
        const list = attemptsByExam.get(at.exam_id) ?? []
        list.push(at)
        attemptsByExam.set(at.exam_id, list)
      }

      if (!cancelled) {
        setRows(
          assignments.map((assignment) => ({
            assignment,
            settings: settingsByExam.get(assignment.exam_id) ?? null,
            attempts: attemptsByExam.get(assignment.exam_id) ?? [],
          }))
        )
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [profile, orgId])

  if (loading) return <PageSkeleton />

  return (
    <div className="page">
      <h1>My quizzes</h1>
      {rows.length === 0 ? (
        <p>No quizzes assigned to you yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Quiz</th><th>Due</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(({ assignment, settings, attempts }) => {
              const { status, attempt } = getEffectiveStatus(
                { starts_at: assignment.starts_at, ends_at: assignment.ends_at },
                attempts
              )
              const maxAttempts = settings?.max_attempts ?? 1
              const attemptsUsed = attempts.length
              const canAttemptAgain = maxAttempts === 0 || attemptsUsed < maxAttempts

              return (
                <tr key={assignment.id}>
                  <td>{assignment.exam.title}</td>
                  <td>{assignment.due_date ? new Date(assignment.due_date).toLocaleDateString() : '—'}</td>
                  <td>
                    {status === 'in_progress' && <span className="badge in_progress">in progress</span>}
                    {(status === 'passed' || status === 'failed') && (
                      <span className={`badge ${status}`}>{status} ({attempt?.score_percent}%)</span>
                    )}
                    {status === 'missed' && <span className="badge missed">missed</span>}
                    {status === 'too_early' && (
                      <span className="badge">opens {assignment.starts_at ? new Date(assignment.starts_at).toLocaleString() : ''}</span>
                    )}
                    {status === 'not_started' && <span className="badge">not started</span>}
                  </td>
                  <td>
                    {status === 'in_progress' && <Link to={`/my-quizzes/${assignment.id}/take`}>Resume →</Link>}
                    {status === 'not_started' && <Link to={`/my-quizzes/${assignment.id}/take`}>Start →</Link>}
                    {(status === 'too_early' || status === 'missed') && <span style={{ color: 'var(--text-faint)' }}>—</span>}
                    {(status === 'passed' || status === 'failed') &&
                      (canAttemptAgain ? (
                        <Link to={`/my-quizzes/${assignment.id}/take`}>Retake →</Link>
                      ) : (
                        <Link to={`/my-quizzes/attempts/${attempt!.id}/result`}>View result →</Link>
                      ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
