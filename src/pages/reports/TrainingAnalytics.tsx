import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'

const ADMIN_ROLES = new Set(['admin', 'trainer'])

// Sections 2-10 of the Training Analytics spec (Learning Progress, Assignment
// Analytics, Assessment Analytics, Learning System Performance, Member
// Activity, Business Stage Distribution, Trainer Performance, AI Insights,
// Export Reports) have no design detail yet beyond field names — listed here
// as a roadmap rather than built as empty card shells.
const UPCOMING_SECTIONS = [
  'Learning Progress',
  'Assignment Analytics',
  'Assessment Analytics',
  'Learning System Performance',
  'Member Activity',
  'Business Stage Distribution',
  'Trainer Performance',
  'AI Insights',
  'Export Reports',
]

interface OverviewStats {
  totalLearningSystems: number
  publishedLearningSystems: number
  activeLearningSystems: number
  totalLessons: number
  totalMembersEnrolled: number
  completionRate: number | null
}

export default function TrainingAnalytics() {
  const { currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false
  const orgId = currentMembership?.organization.id

  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId || !isAdmin) return
    let cancelled = false

    async function load(org: string) {
      const [pathsRes, stepsRes, progressRes] = await Promise.all([
        supabase.from('learning_paths').select('status').eq('org_id', org),
        supabase
          .from('learning_path_steps')
          .select('id, learning_paths!inner(org_id)', { count: 'exact', head: true })
          .eq('learning_paths.org_id', org),
        supabase
          .from('learning_path_progress')
          .select('user_id, path_id, status, learning_paths!inner(org_id)')
          .eq('learning_paths.org_id', org),
      ])
      if (cancelled) return

      const paths = pathsRes.data ?? []
      const progressRows = (progressRes.data as unknown as { user_id: string; path_id: string; status: string }[]) ?? []
      const enrolledUsers = new Set(progressRows.map((r) => r.user_id))
      const activePathIds = new Set(progressRows.filter((r) => r.status === 'in_progress').map((r) => r.path_id))
      const completedCount = progressRows.filter((r) => r.status === 'completed').length

      setStats({
        totalLearningSystems: paths.length,
        publishedLearningSystems: paths.filter((p) => p.status === 'published').length,
        activeLearningSystems: activePathIds.size,
        totalLessons: stepsRes.count ?? 0,
        totalMembersEnrolled: enrolledUsers.size,
        completionRate: progressRows.length > 0 ? Math.round((completedCount / progressRows.length) * 100) : null,
      })
      setLoading(false)
    }

    setLoading(true)
    load(orgId)
    return () => {
      cancelled = true
    }
  }, [orgId, isAdmin])

  if (!isAdmin) {
    return (
      <div className="page">
        <h1>Training Analytics</h1>
        <p>You don't have permission to view this page.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>Training Analytics</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: 24 }}>
        A snapshot of Learning Systems across your office. Learning Systems are the new course-track
        layer being built on top of your exams — none have been created yet, so most of this will read
        zero until that authoring tool ships.
      </p>

      <div className="overview-grid">
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TOTAL LEARNING SYSTEMS</span></div>
          <div className="kpi-value">{loading ? '—' : stats?.totalLearningSystems ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">PUBLISHED</span></div>
          <div className="kpi-value">{loading ? '—' : stats?.publishedLearningSystems ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">ACTIVE</span></div>
          <div className="kpi-value">{loading ? '—' : stats?.activeLearningSystems ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">TOTAL LESSONS</span></div>
          <div className="kpi-value">{loading ? '—' : stats?.totalLessons ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">MEMBERS ENROLLED</span></div>
          <div className="kpi-value">{loading ? '—' : stats?.totalMembersEnrolled ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">COMPLETION RATE</span></div>
          <div className="kpi-value">{loading || stats?.completionRate === null ? '—' : `${stats?.completionRate}%`}</div>
        </div>
      </div>

      <h4 className="overview-heading" style={{ marginTop: 32 }}>COMING SOON</h4>
      <div className="upcoming-list">
        {UPCOMING_SECTIONS.map((section) => (
          <span className="upcoming-pill" key={section}>
            {section}
            <span className="badge soon-badge">Soon</span>
          </span>
        ))}
      </div>
    </div>
  )
}
