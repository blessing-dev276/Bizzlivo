import { useEffect, useState } from 'react'
import { PageSkeleton } from '../../components/AppSkeleton'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import type { CourseworkAssignment, CourseworkSubmission } from '../../types/database'

interface Row {
  assignment: CourseworkAssignment
  submission: CourseworkSubmission | null
}

const STATUS_LABEL: Record<string, string> = {
  submitted: 'awaiting review',
  approved: 'approved',
  rejected: 'rejected',
  changes_requested: 'changes requested',
}

export default function MyAssignments() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile || !orgId) return
    let cancelled = false

    async function load() {
      const { data: myGroups } = await supabase.from('group_members').select('group_id').eq('user_id', profile!.id)
      const groupIds = (myGroups ?? []).map((g) => g.group_id)

      const [directRes, groupRes] = await Promise.all([
        supabase.from('coursework_targets').select('assignment_id').eq('org_id', orgId!).eq('assigned_to_user', profile!.id),
        groupIds.length > 0
          ? supabase.from('coursework_targets').select('assignment_id').eq('org_id', orgId!).in('assigned_to_group', groupIds)
          : Promise.resolve({ data: [] as { assignment_id: string }[] }),
      ])

      const assignmentIds = [...new Set([...(directRes.data ?? []), ...(groupRes.data ?? [])].map((t) => t.assignment_id))]
      if (assignmentIds.length === 0) {
        if (!cancelled) {
          setRows([])
          setLoading(false)
        }
        return
      }

      const [assignmentsRes, submissionsRes] = await Promise.all([
        supabase.from('coursework_assignments').select('*').in('id', assignmentIds),
        supabase.from('coursework_submissions').select('*').eq('user_id', profile!.id).in('assignment_id', assignmentIds),
      ])
      const submissionByAssignment = new Map((submissionsRes.data as CourseworkSubmission[] | null)?.map((s) => [s.assignment_id, s]))

      if (cancelled) return
      setRows(
        ((assignmentsRes.data as CourseworkAssignment[]) ?? [])
          .map((assignment) => ({ assignment, submission: submissionByAssignment.get(assignment.id) ?? null }))
          .sort((a, b) => new Date(b.assignment.created_at).getTime() - new Date(a.assignment.created_at).getTime())
      )
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [profile, orgId])

  if (loading) return <PageSkeleton />

  return (
    <div className="page">
      <h1>My assignments</h1>
      {rows.length === 0 ? (
        <p>No assignments sent to you yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Assignment</th><th>Due</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(({ assignment, submission }) => (
              <tr key={assignment.id}>
                <td>{assignment.title}</td>
                <td>{assignment.due_date ? new Date(assignment.due_date).toLocaleDateString() : '—'}</td>
                <td>
                  <span className={`badge ${submission?.status ?? ''}`}>
                    {submission ? STATUS_LABEL[submission.status] : 'not started'}
                  </span>
                </td>
                <td>
                  <Link to={`/my-assignments/${assignment.id}`}>
                    {!submission ? 'Start →' : submission.status === 'approved' ? 'View →' : 'View / resubmit →'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
