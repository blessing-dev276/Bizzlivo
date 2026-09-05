import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { getTrainerAssignmentIds } from '../../lib/trainerScope'
import type { CourseworkAssignment, CourseworkSubmissionStatus } from '../../types/database'

interface AssignmentRow extends CourseworkAssignment {
  targetCount: number
  submittedCount: number
  approvedCount: number
  needsWorkCount: number
}

export default function Assignments() {
  const { currentMembership, profile } = useAuth()
  const orgId = currentMembership?.organization.id
  const role = currentMembership?.role
  const [rows, setRows] = useState<AssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!orgId) return
    let cancelled = false

    async function load() {
      const { data: assignmentData } = await supabase
        .from('coursework_assignments')
        .select('*')
        .eq('org_id', orgId!)
        .order('created_at', { ascending: false })
      let assignments = (assignmentData as CourseworkAssignment[]) ?? []
      // Trainers manage assignments org-wide by RLS, but only see the ones
      // placed inside a class they're attached to — not every assignment
      // in the office.
      if (role === 'trainer' && profile) {
        const allowedAssignmentIds = await getTrainerAssignmentIds(profile.id)
        assignments = assignments.filter((a) => allowedAssignmentIds.has(a.id))
      }
      const assignmentIds = assignments.map((a) => a.id)
      if (assignmentIds.length === 0) {
        if (!cancelled) {
          setRows([])
          setLoading(false)
        }
        return
      }

      const [targetsRes, submissionsRes] = await Promise.all([
        supabase.from('coursework_targets').select('assignment_id').in('assignment_id', assignmentIds),
        supabase.from('coursework_submissions').select('assignment_id, status').in('assignment_id', assignmentIds),
      ])

      const targetCounts = new Map<string, number>()
      for (const t of targetsRes.data ?? []) {
        targetCounts.set(t.assignment_id, (targetCounts.get(t.assignment_id) ?? 0) + 1)
      }
      const statusCounts = new Map<string, { submitted: number; approved: number; needsWork: number }>()
      for (const s of (submissionsRes.data as { assignment_id: string; status: CourseworkSubmissionStatus }[]) ?? []) {
        const counts = statusCounts.get(s.assignment_id) ?? { submitted: 0, approved: 0, needsWork: 0 }
        if (s.status === 'submitted') counts.submitted += 1
        else if (s.status === 'approved') counts.approved += 1
        else counts.needsWork += 1
        statusCounts.set(s.assignment_id, counts)
      }

      if (cancelled) return
      setRows(
        assignments.map((a) => {
          const counts = statusCounts.get(a.id) ?? { submitted: 0, approved: 0, needsWork: 0 }
          return {
            ...a,
            targetCount: targetCounts.get(a.id) ?? 0,
            submittedCount: counts.submitted,
            approvedCount: counts.approved,
            needsWorkCount: counts.needsWork,
          }
        })
      )
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const visible = useMemo(
    () => rows.filter((r) => r.title.toLowerCase().includes(search.trim().toLowerCase())),
    [rows, search]
  )

  return (
    <div className="page">
      <div className="page-head list-header">
        <h1>Assignments</h1>
        <Link to="/assignments/new"><button>+ New assignment</button></Link>
      </div>

      <div className="toolbar">
        <div className="search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
          <input type="text" placeholder="Search assignments..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : visible.length === 0 ? (
        <p>{rows.length === 0 ? 'No assignments yet — create one to send to your team.' : 'No assignments match this search.'}</p>
      ) : (
        <div className="exam-list">
          {visible.map((a) => (
            <div className="exam-card" key={a.id}>
              <div className="exam-top">
                <div className="exam-title-block">
                  <h3><Link to={`/assignments/${a.id}`}>{a.title}</Link></h3>
                  <div className="exam-sub">
                    {a.due_date ? `Due ${new Date(a.due_date).toLocaleDateString()} · ` : ''}
                    created {new Date(a.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

              <div className="exam-meta">
                <div className="meta-item">
                  <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                  <span className="meta-strong">{a.targetCount}</span>&nbsp;recipient{a.targetCount === 1 ? '' : 's'}
                </div>
                <span className="meta-div" />
                <div className="meta-item">
                  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>
                  <span className="meta-strong">{a.submittedCount}</span>&nbsp;awaiting review
                </div>
                <span className="meta-div" />
                <div className="meta-item">
                  <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>
                  <span className="meta-strong">{a.approvedCount}</span>&nbsp;approved
                </div>
                {a.needsWorkCount > 0 && (
                  <>
                    <span className="meta-div" />
                    <div className="warn-pill">
                      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></svg>
                      {a.needsWorkCount} needs work
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
