import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const MANAGE_ROLES = new Set(['admin'])

interface TeamMemberRow {
  userId: string
  fullName: string
  email: string | null
  completed: number
  assigned: number
  lastActivityAt: string | null
}

interface TeamInfo {
  id: string
  name: string
  leaderId: string | null
  leaderName: string | null
  createdAt: string
}

interface MemberOption {
  id: string
  full_name: string
}

export default function TeamDetail() {
  const { teamId } = useParams<{ teamId: string }>()
  const { currentMembership } = useAuth()
  const canManage = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  const orgId = currentMembership?.organization.id
  const navigate = useNavigate()

  const [team, setTeam] = useState<TeamInfo | null>(null)
  const [members, setMembers] = useState<TeamMemberRow[]>([])
  const [orgMembers, setOrgMembers] = useState<MemberOption[]>([])
  const [teamLeaderOptions, setTeamLeaderOptions] = useState<MemberOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddMember, setShowAddMember] = useState(false)

  async function load(org: string, group: string) {
    const groupRes = await supabase
      .from('groups')
      .select('id, name, leader_id, created_at, leader:profiles!leader_id(full_name)')
      .eq('id', group)
      .eq('org_id', org)
      .single()
    if (!groupRes.data) {
      setTeam(null)
      setLoading(false)
      return
    }
    const g = groupRes.data as unknown as { id: string; name: string; leader_id: string | null; created_at: string; leader: { full_name: string } | null }
    setTeam({ id: g.id, name: g.name, leaderId: g.leader_id, leaderName: g.leader?.full_name ?? null, createdAt: g.created_at })

    const membersRes = await supabase
      .from('group_members')
      .select('user_id, profile:profiles(full_name, email)')
      .eq('group_id', group)
    const memberRows = (membersRes.data as unknown as { user_id: string; profile: { full_name: string; email: string | null } | null }[]) ?? []
    const userIds = memberRows.map((m) => m.user_id)
    if (userIds.length === 0) {
      setMembers([])
      setLoading(false)
      return
    }

    const [attemptsRes, assignmentsRes] = await Promise.all([
      supabase.from('attempts').select('user_id, submitted_at').eq('org_id', org).eq('status', 'submitted').eq('is_guest', false).in('user_id', userIds),
      supabase.from('exam_assignments').select('assigned_to_user').eq('org_id', org).in('assigned_to_user', userIds),
    ])

    const completedByUser = new Map<string, number>()
    const lastActivityByUser = new Map<string, string>()
    for (const a of attemptsRes.data ?? []) {
      completedByUser.set(a.user_id, (completedByUser.get(a.user_id) ?? 0) + 1)
      if (a.submitted_at) {
        const prev = lastActivityByUser.get(a.user_id)
        if (!prev || new Date(a.submitted_at) > new Date(prev)) lastActivityByUser.set(a.user_id, a.submitted_at)
      }
    }
    const assignedByUser = new Map<string, number>()
    for (const a of assignmentsRes.data ?? []) {
      if (!a.assigned_to_user) continue
      assignedByUser.set(a.assigned_to_user, (assignedByUser.get(a.assigned_to_user) ?? 0) + 1)
    }

    setMembers(memberRows.map((m) => ({
      userId: m.user_id,
      fullName: m.profile?.full_name ?? 'Unknown',
      email: m.profile?.email ?? null,
      completed: completedByUser.get(m.user_id) ?? 0,
      assigned: assignedByUser.get(m.user_id) ?? 0,
      lastActivityAt: lastActivityByUser.get(m.user_id) ?? null,
    })))
    setLoading(false)
  }

  useEffect(() => {
    if (!orgId || !canManage || !teamId) return
    setLoading(true)
    load(orgId, teamId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, canManage, teamId])

  useEffect(() => {
    if (!orgId || !canManage) return
    supabase
      .from('memberships')
      .select('user_id, role, profile:profiles(id, full_name)')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .then(({ data }) => {
        const rows = (data as unknown as { user_id: string; role: string; profile: MemberOption | null }[]) ?? []
        const profiles = rows.filter((r) => r.profile)
        setOrgMembers(profiles.map((r) => r.profile as MemberOption))
        // Only members holding the Team Leader role are eligible to lead a team.
        setTeamLeaderOptions(profiles.filter((r) => r.role === 'team_leader').map((r) => r.profile as MemberOption))
      })
  }, [orgId, canManage])

  async function renameTeam() {
    if (!team) return
    const next = prompt('Team name', team.name)
    if (next === null || !next.trim() || next.trim() === team.name) return
    setBusy(true)
    const { error: updateError } = await supabase.from('groups').update({ name: next.trim() }).eq('id', team.id)
    setBusy(false)
    if (updateError) setError(updateError.message)
    else if (orgId && teamId) await load(orgId, teamId)
  }

  async function changeLeader(leaderId: string) {
    if (!team) return
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase.from('groups').update({ leader_id: leaderId || null }).eq('id', team.id)
    setBusy(false)
    if (updateError) setError(updateError.message)
    else if (orgId && teamId) await load(orgId, teamId)
  }

  async function addMember(userId: string) {
    if (!team) return
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('group_members').insert({ group_id: team.id, user_id: userId })
    setBusy(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setShowAddMember(false)
    if (orgId && teamId) await load(orgId, teamId)
  }

  async function removeMember(userId: string) {
    if (!team) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('group_members').delete().eq('group_id', team.id).eq('user_id', userId)
    setBusy(false)
    if (deleteError) setError(deleteError.message)
    else if (orgId && teamId) await load(orgId, teamId)
  }

  async function deleteTeam() {
    if (!team) return
    if (!confirm(`Delete "${team.name}" permanently? This removes the team and its member list — it doesn't touch anyone's quiz or assignment history.`)) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('groups').delete().eq('id', team.id)
    setBusy(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    navigate('/team')
  }

  if (!canManage) {
    return (
      <div className="page">
        <h1>Team Details</h1>
        <p>You don't have permission to view this page.</p>
      </div>
    )
  }

  if (!loading && !team) {
    return (
      <div className="page">
        <h1>Team not found</h1>
        <Link to="/team">← Back to Team</Link>
      </div>
    )
  }

  const totalCompleted = members.reduce((sum, m) => sum + m.completed, 0)
  const totalAssigned = members.reduce((sum, m) => sum + m.assigned, 0)
  const completionRate = totalAssigned > 0 ? Math.min(100, Math.round((totalCompleted / totalAssigned) * 100)) : null
  const memberIds = new Set(members.map((m) => m.userId))
  const addableMembers = orgMembers.filter((m) => !memberIds.has(m.id))

  return (
    <div className="page">
      <Link to="/team" style={{ fontSize: 13.5 }}>← Back to Team</Link>
      <div className="page-head list-header" style={{ marginTop: 10, marginBottom: 0 }}>
        <h1 style={{ margin: 0 }}>{loading ? 'Loading…' : team?.name}</h1>
        {!loading && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="secondary" onClick={renameTeam} disabled={busy}>Rename</button>
            <button type="button" className="danger" onClick={deleteTeam} disabled={busy}>Delete team</button>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <h4 className="overview-heading" style={{ marginTop: 20 }}>TEAM OVERVIEW</h4>
      <div className="overview-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 28 }}>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TEAM LEADER</span></div>
          {loading ? (
            <div className="kpi-value" style={{ fontSize: 18 }}>—</div>
          ) : (
            <select
              value={team?.leaderId ?? ''}
              onChange={(e) => changeLeader(e.target.value)}
              disabled={busy}
              style={{ marginTop: 6, maxWidth: 220 }}
            >
              <option value="">Unassigned</option>
              {teamLeaderOptions.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          )}
          {!loading && teamLeaderOptions.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
              No one has the Team Leader role yet — promote a member on the Members page.
            </p>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">MEMBERS</span></div>
          <div className="kpi-value">{loading ? '—' : members.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">CREATED</span></div>
          <div className="kpi-value" style={{ fontSize: 18 }}>{loading ? '—' : team ? new Date(team.createdAt).toLocaleDateString() : '—'}</div>
        </div>
      </div>

      <h4 className="overview-heading">TEAM STATISTICS</h4>
      <div className="overview-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 28 }}>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">COMPLETION RATE</span></div>
          <div className="kpi-value">{loading || completionRate === null ? '—' : `${completionRate}%`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">EXAMS COMPLETED</span></div>
          <div className="kpi-value">{loading ? '—' : totalCompleted}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span className="kpi-label">HEALTH SCORE</span>
            <span className="badge soon-badge">Soon</span>
          </div>
          <div className="kpi-value">—</div>
        </div>
      </div>

      <div className="page-head list-header" style={{ marginBottom: 0 }}>
        <h4 className="overview-heading" style={{ margin: 0 }}>TEAM MEMBERS</h4>
        <button type="button" className="secondary" onClick={() => setShowAddMember(true)} disabled={loading}>+ Add member</button>
      </div>
      {loading ? (
        <p className="empty-row">Loading…</p>
      ) : members.length === 0 ? (
        <p className="empty-row" style={{ marginTop: 10 }}>No members in this team yet.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Quizzes Completed</th>
                <th>Last Activity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td>{m.fullName}</td>
                  <td className="cell-dim">{m.email ?? '—'}</td>
                  <td>{m.completed} / {m.assigned}</td>
                  <td className="cell-dim">{m.lastActivityAt ? new Date(m.lastActivityAt).toLocaleDateString() : '—'}</td>
                  <td><button type="button" className="secondary" onClick={() => removeMember(m.userId)} disabled={busy}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddMember && (
        <div className="modal-backdrop" onClick={() => setShowAddMember(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add a team member</h2>
            {addableMembers.length === 0 ? (
              <p className="empty-row">Every active member is already on this team.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                {addableMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="secondary"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => addMember(m.id)}
                    disabled={busy}
                  >
                    {m.full_name}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => setShowAddMember(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
