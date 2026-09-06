import { useEffect, useState } from 'react'
import { PageSkeleton } from '../../components/AppSkeleton'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getEffectiveStatus, healOrgExamAttempts } from '../../lib/examLifecycle'
import type { Attempt, Exam, ExamAssignment, Group, Profile } from '../../types/database'

type AssignmentWithGroup = ExamAssignment & { group: Pick<Group, 'name'> | null }

interface RosterRow {
  profile: Profile
  assignment: ExamAssignment
  assignedVia: string
  attempts: Attempt[]
}

export default function ExamRoster() {
  const { examId } = useParams<{ examId: string }>()
  const [exam, setExam] = useState<Exam | null>(null)
  const [rows, setRows] = useState<RosterRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!examId) return
    let cancelled = false

    async function load() {
      const { data: examData } = await supabase.from('exams').select('*').eq('id', examId).single()
      if (!examData) {
        if (!cancelled) setLoading(false)
        return
      }
      const orgId = (examData as Exam).org_id

      // Reconcile stale/missed attempts for every assigned member before
      // reading — same self-heal used on TakeExam.tsx/MyExams.tsx/Dashboard.
      await healOrgExamAttempts(orgId, examId!)

      const { data: assignments } = await supabase
        .from('exam_assignments')
        .select('*, group:groups(name)')
        .eq('exam_id', examId)
      const assignmentRows = (assignments as AssignmentWithGroup[]) ?? []
      const groupIds = assignmentRows.filter((a) => a.assigned_to_group).map((a) => a.assigned_to_group!)

      const { data: groupMembers } = groupIds.length > 0
        ? await supabase.from('group_members').select('group_id, user_id').in('group_id', groupIds)
        : { data: [] as { group_id: string; user_id: string }[] }

      const memberEntries = new Map<string, { assignment: AssignmentWithGroup; assignedVia: string }>()
      for (const a of assignmentRows) {
        if (a.assigned_to_user && !memberEntries.has(a.assigned_to_user)) {
          memberEntries.set(a.assigned_to_user, { assignment: a, assignedVia: 'Direct' })
        }
      }
      for (const gm of groupMembers ?? []) {
        if (memberEntries.has(gm.user_id)) continue
        const assignment = assignmentRows.find((a) => a.assigned_to_group === gm.group_id)
        if (assignment) memberEntries.set(gm.user_id, { assignment, assignedVia: assignment.group?.name ?? 'Group' })
      }

      const memberIds = [...memberEntries.keys()]
      if (memberIds.length === 0) {
        if (!cancelled) {
          setExam(examData as Exam)
          setRows([])
          setLoading(false)
        }
        return
      }

      const [profilesRes, attemptsRes] = await Promise.all([
        supabase.from('profiles').select('*').in('id', memberIds),
        supabase.from('attempts').select('*').eq('exam_id', examId).in('user_id', memberIds),
      ])
      const profileById = new Map((profilesRes.data as Profile[] | null)?.map((p) => [p.id, p]))
      const attemptsByUser = new Map<string, Attempt[]>()
      for (const at of (attemptsRes.data as Attempt[]) ?? []) {
        if (!at.user_id) continue
        const list = attemptsByUser.get(at.user_id) ?? []
        list.push(at)
        attemptsByUser.set(at.user_id, list)
      }

      if (cancelled) return
      setExam(examData as Exam)
      setRows(
        memberIds.flatMap((userId) => {
          const profile = profileById.get(userId)
          const entry = memberEntries.get(userId)!
          if (!profile) return []
          return [{ profile, assignment: entry.assignment, assignedVia: entry.assignedVia, attempts: attemptsByUser.get(userId) ?? [] }]
        })
      )
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [examId])

  if (loading) return <PageSkeleton />
  if (!exam) return <div className="page"><p>Quiz not found.</p></div>

  return (
    <div className="page">
      <h1>Assignment roster — {exam.title}</h1>
      {rows.length === 0 ? (
        <p>No members assigned to this quiz yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Assigned via</th>
              <th>Window</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ profile, assignment, assignedVia, attempts }) => {
              const { status, attempt } = getEffectiveStatus(
                { starts_at: assignment.starts_at, ends_at: assignment.ends_at },
                attempts
              )
              return (
                <tr key={profile.id}>
                  <td>
                    {attempt ? (
                      <Link to={`/quizzes/${examId}/analytics/${attempt.id}`}>{profile.full_name}</Link>
                    ) : (
                      profile.full_name
                    )}
                  </td>
                  <td>{profile.email}</td>
                  <td>{assignedVia}</td>
                  <td>
                    {assignment.starts_at && assignment.ends_at
                      ? `${new Date(assignment.starts_at).toLocaleString()} – ${new Date(assignment.ends_at).toLocaleTimeString()}`
                      : '—'}
                  </td>
                  <td><span className={`badge ${status}`}>{status.replace('_', ' ')}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
