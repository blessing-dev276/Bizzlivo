import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { expandTargetsToUserIds, notifyUsers } from '../../lib/notifications'
import type { Exam, Group, Profile } from '../../types/database'

type Target = { kind: 'user' | 'group'; id: string }

export default function Assign() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const location = useLocation()
  const preselected = location.state as { examId?: string } | null

  const [exams, setExams] = useState<Exam[]>([])
  const [members, setMembers] = useState<{ id: string; profile: Profile }[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [examId, setExamId] = useState(preselected?.examId ?? '')
  const [targets, setTargets] = useState<Target[]>([])
  const [dueDate, setDueDate] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!orgId) return
    async function load() {
      const [examsRes, membersRes, groupsRes] = await Promise.all([
        supabase.from('exams').select('*').eq('org_id', orgId!).eq('status', 'published'),
        supabase.from('memberships').select('id, profile:profiles(*)').eq('org_id', orgId!).eq('status', 'active'),
        supabase.from('groups').select('*').eq('org_id', orgId!),
      ])
      setExams((examsRes.data as Exam[]) ?? [])
      setMembers((membersRes.data as unknown as { id: string; profile: Profile }[]) ?? [])
      setGroups((groupsRes.data as Group[]) ?? [])
    }
    load()
  }, [orgId])

  function toggleTarget(target: Target) {
    setTargets((prev) =>
      prev.some((t) => t.kind === target.kind && t.id === target.id)
        ? prev.filter((t) => !(t.kind === target.kind && t.id === target.id))
        : [...prev, target]
    )
  }

  async function handleAssign(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !examId || targets.length === 0) return
    setError(null)
    setSuccess(null)

    const scheduleFieldsFilled = [scheduledDate, startTime, endTime].filter(Boolean).length
    if (scheduleFieldsFilled > 0 && scheduleFieldsFilled < 3) {
      setError('Set the date, start time, and end time together, or leave all three blank.')
      return
    }

    let startsAt: string | null = null
    let endsAt: string | null = null
    if (scheduledDate && startTime && endTime) {
      startsAt = new Date(`${scheduledDate}T${startTime}`).toISOString()
      endsAt = new Date(`${scheduledDate}T${endTime}`).toISOString()
      if (endsAt <= startsAt) {
        setError('The end time must be after the start time.')
        return
      }
    }

    setSubmitting(true)

    const rows = targets.map((t) => ({
      org_id: orgId,
      exam_id: examId,
      assigned_to_user: t.kind === 'user' ? t.id : null,
      assigned_to_group: t.kind === 'group' ? t.id : null,
      assigned_by: profile.id,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      starts_at: startsAt,
      ends_at: endsAt,
    }))

    const { error: insertError } = await supabase.from('exam_assignments').insert(rows)
    setSubmitting(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setSuccess(`Assigned to ${targets.length} target(s).`)

    try {
      const examTitle = exams.find((e) => e.id === examId)?.title ?? 'a quiz'
      const userIds = await expandTargetsToUserIds(targets)
      await notifyUsers(orgId, userIds, 'exam_assigned', { text: `You've been assigned "${examTitle}"`, link: '/my-quizzes' })
    } catch {
      // Non-fatal — the assignment itself already succeeded.
    }

    setTargets([])
  }

  return (
    <div className="page">
      <h1>Assign quiz</h1>

      {exams.length === 0 ? (
        <p>No published quizzes yet. Publish a quiz before assigning it.</p>
      ) : (
        <form onSubmit={handleAssign} style={{ maxWidth: 480 }}>
          <label>
            Exam
            <select value={examId} onChange={(e) => setExamId(e.target.value)} required>
              <option value="">— Select a quiz —</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>{exam.title}</option>
              ))}
            </select>
          </label>

          <label>
            Due date (optional)
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>

          <h2>Scheduled window (optional)</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: -8 }}>
            If set, the quiz can only be taken within this window — missing it counts as a failure.
          </p>
          <label>
            Date
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
          </label>
          <label>
            Start time
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label>
            End time
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>

          <h2>Members</h2>
          {members.map((m) => (
            <div className="toggle-row" key={m.id}>
              <label>{m.profile?.full_name}</label>
              <input
                type="checkbox"
                checked={targets.some((t) => t.kind === 'user' && t.id === m.profile.id)}
                onChange={() => toggleTarget({ kind: 'user', id: m.profile.id })}
              />
            </div>
          ))}

          {groups.length > 0 && (
            <>
              <h2>Groups</h2>
              {groups.map((g) => (
                <div className="toggle-row" key={g.id}>
                  <label>{g.name}</label>
                  <input
                    type="checkbox"
                    checked={targets.some((t) => t.kind === 'group' && t.id === g.id)}
                    onChange={() => toggleTarget({ kind: 'group', id: g.id })}
                  />
                </div>
              ))}
            </>
          )}

          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-info">{success}</p>}

          <button type="submit" disabled={submitting || !examId || targets.length === 0} style={{ marginTop: 16 }}>
            {submitting ? 'Assigning…' : 'Assign'}
          </button>
        </form>
      )}
    </div>
  )
}
