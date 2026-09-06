import { useEffect, useState } from 'react'
import { PageSkeleton } from '../../components/AppSkeleton'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { notifyUsers } from '../../lib/notifications'
import type { CourseworkAssignment, CourseworkSubmission, CourseworkSubmissionStatus, Profile } from '../../types/database'

interface RosterRow {
  profile: Profile
  assignedVia: string
  submission: CourseworkSubmission | null
}

const STATUS_LABEL: Record<CourseworkSubmissionStatus, string> = {
  submitted: 'awaiting review',
  approved: 'approved',
  rejected: 'rejected',
  changes_requested: 'changes requested',
}

export default function AssignmentDetail() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const { profile } = useAuth()
  const [assignment, setAssignment] = useState<CourseworkAssignment | null>(null)
  const [rows, setRows] = useState<RosterRow[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  async function load() {
    if (!assignmentId) return
    const { data: assignmentData } = await supabase
      .from('coursework_assignments')
      .select('*')
      .eq('id', assignmentId)
      .single()
    if (!assignmentData) {
      setLoading(false)
      return
    }
    setAssignment(assignmentData as CourseworkAssignment)

    const { data: targets } = await supabase
      .from('coursework_targets')
      .select('*, group:groups(name)')
      .eq('assignment_id', assignmentId)
    const targetRows = (targets as { assigned_to_user: string | null; assigned_to_group: string | null; group: { name: string } | null }[]) ?? []
    const groupIds = targetRows.filter((t) => t.assigned_to_group).map((t) => t.assigned_to_group!)

    const { data: groupMembers } =
      groupIds.length > 0
        ? await supabase.from('group_members').select('group_id, user_id').in('group_id', groupIds)
        : { data: [] as { group_id: string; user_id: string }[] }

    const memberEntries = new Map<string, string>()
    for (const t of targetRows) {
      if (t.assigned_to_user && !memberEntries.has(t.assigned_to_user)) memberEntries.set(t.assigned_to_user, 'Direct')
    }
    for (const gm of groupMembers ?? []) {
      if (memberEntries.has(gm.user_id)) continue
      const t = targetRows.find((tr) => tr.assigned_to_group === gm.group_id)
      if (t) memberEntries.set(gm.user_id, t.group?.name ?? 'Group')
    }

    const memberIds = [...memberEntries.keys()]
    if (memberIds.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    const [profilesRes, submissionsRes] = await Promise.all([
      supabase.from('profiles').select('*').in('id', memberIds),
      supabase.from('coursework_submissions').select('*').eq('assignment_id', assignmentId).in('user_id', memberIds),
    ])
    const profileById = new Map((profilesRes.data as Profile[] | null)?.map((p) => [p.id, p]))
    const submissionByUser = new Map((submissionsRes.data as CourseworkSubmission[] | null)?.map((s) => [s.user_id, s]))

    setRows(
      memberIds.flatMap((userId) => {
        const memberProfile = profileById.get(userId)
        if (!memberProfile) return []
        return [{ profile: memberProfile, assignedVia: memberEntries.get(userId)!, submission: submissionByUser.get(userId) ?? null }]
      })
    )
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId])

  const selectedRow = rows.find((r) => r.profile.id === selectedUserId) ?? null

  function openReview(row: RosterRow) {
    setSelectedUserId(row.profile.id)
    setReviewNote(row.submission?.review_note ?? '')
    setReviewError(null)
  }

  async function review(status: CourseworkSubmissionStatus) {
    if (!selectedRow?.submission || !profile) return
    setReviewing(true)
    setReviewError(null)
    const { error } = await supabase
      .from('coursework_submissions')
      .update({
        status,
        review_note: reviewNote.trim() || null,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', selectedRow.submission.id)
    setReviewing(false)
    if (error) {
      setReviewError(error.message)
      return
    }

    try {
      await notifyUsers(selectedRow.submission.org_id, [selectedRow.profile.id], 'coursework_reviewed', {
        text: `Your "${assignment?.title}" was ${STATUS_LABEL[status]}`,
        link: `/my-assignments/${selectedRow.submission.assignment_id}`,
      })
    } catch {
      // Non-fatal — the review itself already succeeded.
    }

    setSelectedUserId(null)
    await load()
  }

  if (loading) return <PageSkeleton />
  if (!assignment) return <div className="page"><p>Assignment not found.</p></div>

  return (
    <div className="page">
      <h1>{assignment.title}</h1>
      <p style={{ whiteSpace: 'pre-wrap' }}>{assignment.instructions}</p>
      {assignment.reference_link && (
        <p><a href={assignment.reference_link} target="_blank" rel="noreferrer">Reference link →</a></p>
      )}
      <p style={{ color: 'var(--text-dim)' }}>
        {assignment.due_date ? `Due ${new Date(assignment.due_date).toLocaleDateString()} · ` : ''}
        Submit with {[assignment.require_note && 'a text note', assignment.require_link && 'a link'].filter(Boolean).join(' and ')}
      </p>

      <h2 style={{ marginTop: 24 }}>Roster</h2>
      {rows.length === 0 ? (
        <p>No members assigned to this task yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Assigned via</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.profile.id}>
                <td>{row.profile.full_name}</td>
                <td>{row.profile.email}</td>
                <td>{row.assignedVia}</td>
                <td>
                  <span className={`badge ${row.submission?.status ?? ''}`}>
                    {row.submission ? STATUS_LABEL[row.submission.status] : 'not submitted'}
                  </span>
                </td>
                <td>
                  {row.submission && (
                    <button type="button" className="secondary" onClick={() => openReview(row)}>Review →</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedRow?.submission && (
        <div className="modal-backdrop" onClick={() => setSelectedUserId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{selectedRow.profile.full_name}'s submission</h2>

            {selectedRow.submission.note && (
              <p style={{ whiteSpace: 'pre-wrap', background: 'var(--line-soft)', padding: 12, borderRadius: 8 }}>
                {selectedRow.submission.note}
              </p>
            )}
            {selectedRow.submission.link && (
              <p><a href={selectedRow.submission.link} target="_blank" rel="noreferrer">{selectedRow.submission.link} →</a></p>
            )}
            <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
              Submitted {new Date(selectedRow.submission.submitted_at).toLocaleString()}
            </p>

            <label>
              Feedback (optional)
              <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={3} placeholder="What did they do well, or what needs to change?" />
            </label>

            {reviewError && <p className="form-error">{reviewError}</p>}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => review('approved')} disabled={reviewing}>Approve</button>
              <button type="button" className="secondary" onClick={() => review('changes_requested')} disabled={reviewing}>Request changes</button>
              <button type="button" className="danger" onClick={() => review('rejected')} disabled={reviewing}>Reject</button>
              <button type="button" className="secondary" onClick={() => setSelectedUserId(null)} disabled={reviewing}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
