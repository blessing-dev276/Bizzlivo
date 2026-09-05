import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { supabase } from '../../lib/supabase'

// Planned Sections (nav not built yet), feature-level additions to what
// exists today, and the longer-term roadmap — from the Team Leader Module
// spec. Split into three groups rather than one flat pill dump, matching
// how Growth Hub presents its own not-yet-built pillars.
const PLANNED_SECTIONS = ['Events', 'Communication', 'AI Mentor']
const COMING_SOON = [
  'Assign Mentors',
  'Team Notes',
  'Coaching Sessions',
  'Income Tracking',
  'Goal Tracking',
  'Achievement History',
  'Performance Analytics',
  'Export Reports',
  'Team Events',
  'RSVP Analytics',
]
const FUTURE_ROADMAP = [
  'One-on-One Mentoring',
  'AI Coaching Suggestions',
  'Rewards',
  'Team Challenges',
  'Leader Certification',
]

interface LedTeam {
  id: string
  name: string
  createdAt: string
}

interface TeamMemberRow {
  userId: string
  fullName: string
  email: string | null
  completed: number
  assigned: number
  lastActivityAt: string | null
}

export default function MyTeam() {
  const { profile, currentMembership } = useAuth()
  const orgId = currentMembership?.organization.id

  const [ledTeams, setLedTeams] = useState<LedTeam[]>([])
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)
  const [members, setMembers] = useState<TeamMemberRow[]>([])
  const [loadingTeams, setLoadingTeams] = useState(true)
  const [loadingMembers, setLoadingMembers] = useState(false)

  useEffect(() => {
    if (!orgId || !profile) return
    let cancelled = false

    async function loadTeams(org: string, userId: string) {
      setLoadingTeams(true)
      const { data } = await supabase
        .from('groups')
        .select('id, name, created_at')
        .eq('org_id', org)
        .eq('leader_id', userId)
        .order('name')
      if (cancelled) return
      const teams = (data as LedTeam[] | null)?.map((g) => ({ ...g, createdAt: (g as unknown as { created_at: string }).created_at })) ?? []
      setLedTeams(teams)
      setActiveTeamId(teams[0]?.id ?? null)
      setLoadingTeams(false)
    }

    loadTeams(orgId, profile.id)
    return () => {
      cancelled = true
    }
  }, [orgId, profile])

  useEffect(() => {
    if (!orgId || !activeTeamId) {
      setMembers([])
      return
    }
    let cancelled = false

    async function loadMembers(org: string, group: string) {
      setLoadingMembers(true)
      const membersRes = await supabase
        .from('group_members')
        .select('user_id, profile:profiles(full_name, email)')
        .eq('group_id', group)
      if (cancelled) return
      const memberRows = (membersRes.data as unknown as { user_id: string; profile: { full_name: string; email: string | null } | null }[]) ?? []
      const userIds = memberRows.map((m) => m.user_id)

      if (userIds.length === 0) {
        if (!cancelled) {
          setMembers([])
          setLoadingMembers(false)
        }
        return
      }

      const [attemptsRes, assignmentsRes] = await Promise.all([
        supabase.from('attempts').select('user_id, submitted_at').eq('org_id', org).eq('status', 'submitted').eq('is_guest', false).in('user_id', userIds),
        supabase.from('exam_assignments').select('assigned_to_user').eq('org_id', org).in('assigned_to_user', userIds),
      ])
      if (cancelled) return

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
      setLoadingMembers(false)
    }

    loadMembers(orgId, activeTeamId)
    return () => {
      cancelled = true
    }
  }, [orgId, activeTeamId])

  if (loadingTeams) return <div className="page"><p>Loading…</p></div>

  if (ledTeams.length === 0) {
    return (
      <div className="page">
        <h1>My Team</h1>
        <p>You're not currently leading a team. Ask your office admin to assign you as a team leader.</p>
      </div>
    )
  }

  const activeTeam = ledTeams.find((t) => t.id === activeTeamId) ?? ledTeams[0]
  const totalCompleted = members.reduce((sum, m) => sum + m.completed, 0)
  const totalAssigned = members.reduce((sum, m) => sum + m.assigned, 0)
  const completionRate = totalAssigned > 0 ? Math.min(100, Math.round((totalCompleted / totalAssigned) * 100)) : null

  return (
    <div className="page">
      <div className="page-head">
        <h1>My Team</h1>
        <p>Progress and activity for the team{ledTeams.length > 1 ? ' you lead' : ` you lead — ${activeTeam.name}`}.</p>
      </div>

      {ledTeams.length > 1 && (
        <div className="cycle-toggle" style={{ marginBottom: 24 }}>
          {ledTeams.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === activeTeam.id ? 'active' : ''}
              onClick={() => setActiveTeamId(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <h4 className="overview-heading">TEAM OVERVIEW</h4>
      <div className="overview-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 28 }}>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TEAM LEADER</span></div>
          <div className="kpi-value" style={{ fontSize: 18 }}>{profile?.full_name}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">MEMBERS</span></div>
          <div className="kpi-value">{loadingMembers ? '—' : members.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">CREATED</span></div>
          <div className="kpi-value" style={{ fontSize: 18 }}>{new Date(activeTeam.createdAt).toLocaleDateString()}</div>
        </div>
      </div>

      <h4 className="overview-heading">TEAM STATISTICS</h4>
      <div className="overview-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 28 }}>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">COMPLETION RATE</span></div>
          <div className="kpi-value">{loadingMembers || completionRate === null ? '—' : `${completionRate}%`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">EXAMS COMPLETED</span></div>
          <div className="kpi-value">{loadingMembers ? '—' : totalCompleted}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top">
            <span className="kpi-label">AI INSIGHTS</span>
            <span className="badge soon-badge">Soon</span>
          </div>
          <div className="kpi-value">—</div>
        </div>
      </div>

      <h4 className="overview-heading">TEAM MEMBERS</h4>
      {loadingMembers ? (
        <p className="empty-row">Loading…</p>
      ) : members.length === 0 ? (
        <p className="empty-row">No members in this team yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Exams Completed</th>
                <th>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td>{m.fullName}</td>
                  <td className="cell-dim">{m.email ?? '—'}</td>
                  <td>{m.completed} / {m.assigned}</td>
                  <td className="cell-dim">{m.lastActivityAt ? new Date(m.lastActivityAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="overview-heading" style={{ marginTop: 32 }}>PLANNED SECTIONS</h4>
      <div className="upcoming-list">
        {PLANNED_SECTIONS.map((s) => (
          <span className="upcoming-pill" key={s}>{s}<span className="badge soon-badge">Soon</span></span>
        ))}
      </div>

      <h4 className="overview-heading" style={{ marginTop: 24 }}>COMING SOON</h4>
      <div className="upcoming-list">
        {COMING_SOON.map((s) => (
          <span className="upcoming-pill" key={s}>{s}<span className="badge soon-badge">Soon</span></span>
        ))}
      </div>

      <h4 className="overview-heading" style={{ marginTop: 24 }}>FUTURE ROADMAP</h4>
      <div className="upcoming-list">
        {FUTURE_ROADMAP.map((r) => (
          <span className="upcoming-pill" key={r}>{r}<span className="badge soon-badge">Soon</span></span>
        ))}
      </div>
    </div>
  )
}
