import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

// Matches Layout.tsx's own MANAGE_ROLES split — the spec gives Owner/Admin
// "Full" access but lists Trainer as "Coming Soon", so this deliberately
// does NOT reuse the app-wide isAdmin (admin/trainer) gate.
const MANAGE_ROLES = new Set(['admin'])
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

type SortKey = 'name' | 'members' | 'activeToday' | 'completionRate' | 'lastActivity'

interface TeamRow {
  id: string
  name: string
  leaderName: string | null
  memberCount: number
  activeToday: number
  completionRate: number | null
  lastActivityAt: string | null
  status: 'Active' | 'Inactive'
}

interface Overview {
  totalTeams: number
  activeTeams: number
  totalMembers: number
  activeMembers: number
  completionRate: number | null
}

interface MemberOption {
  id: string
  full_name: string
}

const UPCOMING_SECTIONS = ['Performance Charts', 'Leaderboard', 'AI Insights', 'Reports']

function isToday(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export default function TeamPerformance() {
  const { currentMembership } = useAuth()
  const canManage = currentMembership ? MANAGE_ROLES.has(currentMembership.role) : false
  const orgId = currentMembership?.organization.id
  const navigate = useNavigate()

  const [teams, setTeams] = useState<TeamRow[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [members, setMembers] = useState<MemberOption[]>([])
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamLeaderId, setNewTeamLeaderId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId || !canManage) return
    let cancelled = false

    async function load(org: string) {
      const groupsRes = await supabase
        .from('groups')
        .select('id, name, leader_id, leader:profiles!leader_id(full_name)')
        .eq('org_id', org)
        .order('name')
      const groups = (groupsRes.data as unknown as { id: string; name: string; leader_id: string | null; leader: { full_name: string } | null }[]) ?? []
      const groupIds = groups.map((g) => g.id)

      if (groupIds.length === 0) {
        if (!cancelled) {
          setTeams([])
          setOverview({ totalTeams: 0, activeTeams: 0, totalMembers: 0, activeMembers: 0, completionRate: null })
          setLoading(false)
        }
        return
      }

      const [membersRes, attemptsRes, courseworkRes, assignmentsRes] = await Promise.all([
        supabase.from('group_members').select('group_id, user_id').in('group_id', groupIds),
        supabase.from('attempts').select('user_id, submitted_at').eq('org_id', org).eq('status', 'submitted').eq('is_guest', false),
        supabase.from('coursework_submissions').select('user_id, submitted_at').eq('org_id', org),
        supabase.from('exam_assignments').select('assigned_to_user').eq('org_id', org),
      ])
      if (cancelled) return

      const groupMemberIds = new Map<string, Set<string>>()
      for (const g of groups) groupMemberIds.set(g.id, new Set())
      for (const row of membersRes.data ?? []) {
        groupMemberIds.get(row.group_id)?.add(row.user_id)
      }

      const lastActivityByUser = new Map<string, string>()
      const bump = (userId: string, at: string | null) => {
        if (!at) return
        const prev = lastActivityByUser.get(userId)
        if (!prev || new Date(at) > new Date(prev)) lastActivityByUser.set(userId, at)
      }
      const completedByUser = new Map<string, number>()
      for (const a of attemptsRes.data ?? []) {
        bump(a.user_id, a.submitted_at)
        completedByUser.set(a.user_id, (completedByUser.get(a.user_id) ?? 0) + 1)
      }
      for (const c of courseworkRes.data ?? []) bump(c.user_id, c.submitted_at)

      const assignedByUser = new Map<string, number>()
      for (const a of assignmentsRes.data ?? []) {
        if (!a.assigned_to_user) continue
        assignedByUser.set(a.assigned_to_user, (assignedByUser.get(a.assigned_to_user) ?? 0) + 1)
      }

      const now = Date.now()
      const rows: TeamRow[] = groups.map((g) => {
        const memberIds = [...(groupMemberIds.get(g.id) ?? [])]
        const activeToday = memberIds.filter((id) => {
          const at = lastActivityByUser.get(id)
          return at ? isToday(at) : false
        }).length
        let lastActivityAt: string | null = null
        for (const id of memberIds) {
          const at = lastActivityByUser.get(id)
          if (at && (!lastActivityAt || new Date(at) > new Date(lastActivityAt))) lastActivityAt = at
        }
        const totalAssigned = memberIds.reduce((sum, id) => sum + (assignedByUser.get(id) ?? 0), 0)
        const totalCompleted = memberIds.reduce((sum, id) => sum + (completedByUser.get(id) ?? 0), 0)
        const completionRate = totalAssigned > 0 ? Math.min(100, Math.round((totalCompleted / totalAssigned) * 100)) : null
        const recentlyActive = memberIds.some((id) => {
          const at = lastActivityByUser.get(id)
          return at ? now - new Date(at).getTime() <= SEVEN_DAYS_MS : false
        })

        return {
          id: g.id,
          name: g.name,
          leaderName: g.leader?.full_name ?? null,
          memberCount: memberIds.length,
          activeToday,
          completionRate,
          lastActivityAt,
          status: recentlyActive ? 'Active' : 'Inactive',
        }
      })

      const allTeamMemberIds = new Set<string>()
      for (const set of groupMemberIds.values()) for (const id of set) allTeamMemberIds.add(id)
      const activeMemberIds = [...allTeamMemberIds].filter((id) => {
        const at = lastActivityByUser.get(id)
        return at ? now - new Date(at).getTime() <= SEVEN_DAYS_MS : false
      })
      const overallAssigned = [...allTeamMemberIds].reduce((sum, id) => sum + (assignedByUser.get(id) ?? 0), 0)
      const overallCompleted = [...allTeamMemberIds].reduce((sum, id) => sum + (completedByUser.get(id) ?? 0), 0)

      if (!cancelled) {
        setTeams(rows)
        setOverview({
          totalTeams: groups.length,
          activeTeams: rows.filter((r) => r.status === 'Active').length,
          totalMembers: allTeamMemberIds.size,
          activeMembers: activeMemberIds.length,
          completionRate: overallAssigned > 0 ? Math.min(100, Math.round((overallCompleted / overallAssigned) * 100)) : null,
        })
        setLoading(false)
      }
    }

    setLoading(true)
    load(orgId)
    return () => {
      cancelled = true
    }
  }, [orgId, canManage])

  // Only members holding the Team Leader role are eligible to lead a team.
  useEffect(() => {
    if (!orgId || !canManage) return
    supabase
      .from('memberships')
      .select('user_id, profile:profiles(id, full_name)')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .eq('role', 'team_leader')
      .then(({ data }) => {
        const rows = (data as unknown as { user_id: string; profile: MemberOption | null }[]) ?? []
        setMembers(rows.filter((r) => r.profile).map((r) => r.profile as MemberOption))
      })
  }, [orgId, canManage])

  async function createTeam(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !newTeamName.trim()) return
    setCreating(true)
    setCreateError(null)
    const { data, error: insertError } = await supabase
      .from('groups')
      .insert({ org_id: orgId, name: newTeamName.trim(), leader_id: newTeamLeaderId || null })
      .select()
      .single()
    setCreating(false)
    if (insertError || !data) {
      setCreateError(insertError?.message ?? 'Could not create team.')
      return
    }
    navigate(`/team/${data.id}`)
  }

  const visibleTeams = useMemo(() => {
    const filtered = teams.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'members') cmp = a.memberCount - b.memberCount
      else if (sortKey === 'activeToday') cmp = a.activeToday - b.activeToday
      else if (sortKey === 'completionRate') cmp = (a.completionRate ?? -1) - (b.completionRate ?? -1)
      else if (sortKey === 'lastActivity') cmp = new Date(a.lastActivityAt ?? 0).getTime() - new Date(b.lastActivityAt ?? 0).getTime()
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [teams, search, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  if (!canManage) {
    return (
      <div className="page">
        <h1>Team</h1>
        <p>You don't have permission to view this page.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head list-header" style={{ marginBottom: 0 }}>
        <div>
          <h1>Team</h1>
          <p style={{ color: 'var(--text-dim)', margin: 0 }}>
            Growth, engagement, and performance for every team in your office.
          </p>
        </div>
        <button type="button" onClick={() => setShowCreateTeam(true)}>+ Create team</button>
      </div>

      {showCreateTeam && (
        <div className="modal-backdrop" onClick={() => setShowCreateTeam(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={createTeam}>
              <h2>Create a team</h2>
              <label>
                Team name
                <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} required autoFocus placeholder="e.g. Lagos Sales Team" />
              </label>
              <label>
                Team leader (optional — you can assign one later)
                <select value={newTeamLeaderId} onChange={(e) => setNewTeamLeaderId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
                {members.length === 0 && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-faint)', fontWeight: 400, marginTop: 4 }}>
                    No one has the Team Leader role yet — promote a member to Team Leader on the Members page first.
                  </p>
                )}
              </label>
              {createError && <p className="form-error">{createError}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={creating || !newTeamName.trim()}>{creating ? 'Creating…' : 'Create & add members →'}</button>
                <button type="button" className="secondary" onClick={() => setShowCreateTeam(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="overview-grid" style={{ marginTop: 24 }}>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TOTAL TEAMS</span></div>
          <div className="kpi-value">{loading ? '—' : overview?.totalTeams ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">ACTIVE TEAMS</span></div>
          <div className="kpi-value">{loading ? '—' : overview?.activeTeams ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TOTAL MEMBERS</span></div>
          <div className="kpi-value">{loading ? '—' : overview?.totalMembers ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">ACTIVE MEMBERS</span></div>
          <div className="kpi-value">{loading ? '—' : overview?.activeMembers ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">COMPLETION RATE</span></div>
          <div className="kpi-value">{loading || overview?.completionRate == null ? '—' : `${overview?.completionRate}%`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span className="kpi-label">TEAM HEALTH SCORE</span>
            <span className="badge soon-badge">Soon</span>
          </div>
          <div className="kpi-value">—</div>
        </div>
      </div>

      <div className="page-head list-header" style={{ marginTop: 32 }}>
        <h2 style={{ margin: 0 }}>Teams</h2>
        <input
          placeholder="Search teams…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 240 }}
        />
      </div>

      {loading ? (
        <p className="empty-row">Loading…</p>
      ) : teams.length === 0 ? (
        <p className="empty-row">
          No teams yet. Teams (built on your existing member groups) will show up here once you have one with members in it.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Team Name</th>
                <th>Team Leader</th>
                <th onClick={() => toggleSort('members')} style={{ cursor: 'pointer' }}>Members</th>
                <th onClick={() => toggleSort('activeToday')} style={{ cursor: 'pointer' }}>Active Today</th>
                <th>Current Stage</th>
                <th onClick={() => toggleSort('completionRate')} style={{ cursor: 'pointer' }}>Completion Rate</th>
                <th>Health Score</th>
                <th onClick={() => toggleSort('lastActivity')} style={{ cursor: 'pointer' }}>Last Activity</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleTeams.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.leaderName ?? '—'}</td>
                  <td>{t.memberCount}</td>
                  <td>{t.activeToday}</td>
                  <td>—</td>
                  <td>{t.completionRate === null ? '—' : `${t.completionRate}%`}</td>
                  <td><span className="badge soon-badge">Soon</span></td>
                  <td>{t.lastActivityAt ? new Date(t.lastActivityAt).toLocaleDateString() : '—'}</td>
                  <td><span className={`badge ${t.status === 'Active' ? 'active' : ''}`}>{t.status}</span></td>
                  <td><Link to={`/team/${t.id}`}>View Details →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="overview-heading" style={{ marginTop: 32 }}>COMING SOON</h4>
      <div className="upcoming-list">
        {UPCOMING_SECTIONS.map((s) => (
          <span className="upcoming-pill" key={s}>{s}<span className="badge soon-badge">Soon</span></span>
        ))}
      </div>
    </div>
  )
}
