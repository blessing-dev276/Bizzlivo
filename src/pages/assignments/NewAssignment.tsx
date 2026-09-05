import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { expandTargetsToUserIds, notifyUsers } from '../../lib/notifications'
import type { Group, Profile } from '../../types/database'

type Target = { kind: 'user' | 'group'; id: string }

export default function NewAssignment() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const navigate = useNavigate()

  const [members, setMembers] = useState<{ id: string; profile: Profile }[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [targets, setTargets] = useState<Target[]>([])

  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [referenceLink, setReferenceLink] = useState('')
  const [requireNote, setRequireNote] = useState(true)
  const [requireLink, setRequireLink] = useState(false)
  const [dueDate, setDueDate] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!orgId) return
    async function load() {
      const [membersRes, groupsRes] = await Promise.all([
        supabase.from('memberships').select('id, profile:profiles(*)').eq('org_id', orgId!).eq('status', 'active'),
        supabase.from('groups').select('*').eq('org_id', orgId!),
      ])
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

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !profile || !title.trim() || !instructions.trim() || targets.length === 0) return
    if (!requireNote && !requireLink) {
      setError('Require at least a text note or a link so members know how to submit.')
      return
    }
    setError(null)
    setSubmitting(true)

    try {
      const { data: assignment, error: assignmentError } = await supabase
        .from('coursework_assignments')
        .insert({
          org_id: orgId,
          title: title.trim(),
          instructions: instructions.trim(),
          reference_link: referenceLink.trim() || null,
          require_note: requireNote,
          require_link: requireLink,
          due_date: dueDate ? new Date(dueDate).toISOString() : null,
          created_by: profile.id,
        })
        .select()
        .single()
      if (assignmentError || !assignment) throw assignmentError ?? new Error('Could not create assignment.')

      const rows = targets.map((t) => ({
        assignment_id: assignment.id,
        org_id: orgId,
        assigned_to_user: t.kind === 'user' ? t.id : null,
        assigned_to_group: t.kind === 'group' ? t.id : null,
      }))
      const { error: targetsError } = await supabase.from('coursework_targets').insert(rows)
      if (targetsError) throw targetsError

      try {
        const userIds = await expandTargetsToUserIds(targets)
        await notifyUsers(orgId, userIds, 'coursework_assigned', {
          text: `New assignment: "${assignment.title}"`,
          link: `/my-assignments/${assignment.id}`,
        })
      } catch {
        // Non-fatal — the assignment itself already succeeded.
      }

      navigate(`/assignments/${assignment.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create assignment.')
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <h1>New assignment</h1>

      <form onSubmit={handleCreate} style={{ maxWidth: 480 }}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="e.g. Design a launch poster" />
        </label>

        <label>
          Instructions
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            required
            rows={5}
            placeholder="What should they do? Be specific about deliverables and format."
          />
        </label>

        <label>
          Reference link (optional)
          <input
            type="url"
            value={referenceLink}
            onChange={(e) => setReferenceLink(e.target.value)}
            placeholder="e.g. a Canva template, brand assets folder..."
          />
        </label>

        <label>
          Due date (optional)
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>

        <h2>How should they submit?</h2>
        <div className="toggle-row">
          <label style={{ margin: 0 }}>Require a text note</label>
          <input type="checkbox" checked={requireNote} onChange={(e) => setRequireNote(e.target.checked)} />
        </div>
        <div className="toggle-row">
          <label style={{ margin: 0 }}>Require a link (Drive, Canva, YouTube, etc.)</label>
          <input type="checkbox" checked={requireLink} onChange={(e) => setRequireLink(e.target.checked)} />
        </div>

        <h2>Send to</h2>
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

        <button type="submit" disabled={submitting || !title || !instructions || targets.length === 0} style={{ marginTop: 16 }}>
          {submitting ? 'Sending…' : 'Send assignment'}
        </button>
      </form>
    </div>
  )
}
