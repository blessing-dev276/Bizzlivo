import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { notifyOrgAdmins } from '../../lib/notifications'
import type { CourseworkAssignment, CourseworkSubmission } from '../../types/database'

const STATUS_LABEL: Record<string, string> = {
  submitted: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
}

export default function SubmitAssignment() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const { profile } = useAuth()
  const [assignment, setAssignment] = useState<CourseworkAssignment | null>(null)
  const [submission, setSubmission] = useState<CourseworkSubmission | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!assignmentId || !profile) return
    let cancelled = false

    async function load() {
      const [{ data: assignmentData, error: assignmentError }, { data: submissionData }] = await Promise.all([
        supabase.from('coursework_assignments').select('*').eq('id', assignmentId).maybeSingle(),
        supabase.from('coursework_submissions').select('*').eq('assignment_id', assignmentId).eq('user_id', profile!.id).maybeSingle(),
      ])
      if (cancelled) return
      if (assignmentError || !assignmentData) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setAssignment(assignmentData as CourseworkAssignment)
      const existing = submissionData as CourseworkSubmission | null
      setSubmission(existing)
      setNote(existing?.note ?? '')
      setLink(existing?.link ?? '')
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [assignmentId, profile])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!assignment || !profile) return
    if (assignment.require_note && !note.trim()) {
      setError('This assignment requires a text note.')
      return
    }
    if (assignment.require_link && !link.trim()) {
      setError('This assignment requires a link.')
      return
    }
    setError(null)
    setSuccess(null)
    setSubmitting(true)

    const { data, error: upsertError } = await supabase
      .from('coursework_submissions')
      .upsert(
        {
          assignment_id: assignment.id,
          org_id: assignment.org_id,
          user_id: profile.id,
          note: note.trim() || null,
          link: link.trim() || null,
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        },
        { onConflict: 'assignment_id,user_id' }
      )
      .select()
      .single()

    setSubmitting(false)
    if (upsertError) {
      setError(upsertError.message)
      return
    }
    setSubmission(data as CourseworkSubmission)
    setSuccess('Submitted — the office will review it soon.')

    try {
      await notifyOrgAdmins(assignment.org_id, 'coursework_submitted', {
        text: `${profile.full_name} submitted "${assignment.title}"`,
        link: `/assignments/${assignment.id}`,
      })
    } catch {
      // Non-fatal — the submission itself already succeeded.
    }
  }

  if (loading) return <div className="page"><p>Loading…</p></div>
  if (notFound || !assignment) return <div className="page"><p>Assignment not found.</p></div>

  const approved = submission?.status === 'approved'
  const needsAttention = submission?.status === 'rejected' || submission?.status === 'changes_requested'

  return (
    <div className="page">
      <h1>{assignment.title}</h1>
      <p style={{ whiteSpace: 'pre-wrap' }}>{assignment.instructions}</p>
      {assignment.reference_link && (
        <p><a href={assignment.reference_link} target="_blank" rel="noreferrer">Reference link →</a></p>
      )}
      {assignment.due_date && (
        <p style={{ color: 'var(--text-dim)' }}>Due {new Date(assignment.due_date).toLocaleDateString()}</p>
      )}

      {submission && (
        <p>
          <span className={`badge ${submission.status}`}>{STATUS_LABEL[submission.status]}</span>
        </p>
      )}

      {needsAttention && submission?.review_note && (
        <p className="form-error">Feedback from the office: {submission.review_note}</p>
      )}

      {approved ? (
        <div className="result-hero" style={{ marginTop: 16 }}>
          <h2 className="result-pass">Approved ✓</h2>
          {submission?.note && <p style={{ whiteSpace: 'pre-wrap' }}>{submission.note}</p>}
          {submission?.link && <p><a href={submission.link} target="_blank" rel="noreferrer">{submission.link} →</a></p>}
          {submission?.review_note && <p style={{ color: 'var(--text-dim)' }}>Office feedback: {submission.review_note}</p>}
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ maxWidth: 480, marginTop: 16 }}>
          {assignment.require_note && (
            <label>
              Your note
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} placeholder="Describe what you did..." />
            </label>
          )}
          {assignment.require_link && (
            <label>
              Link to your work
              <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
            </label>
          )}

          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-info">{success}</p>}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : submission ? 'Resubmit' : 'Submit'}
          </button>
        </form>
      )}

      <p style={{ marginTop: 16 }}><Link to="/my-assignments">Back to my assignments</Link></p>
    </div>
  )
}
