import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

// Permission matrix from the spec: Admin sees the real thing, Trainer and
// Team Leader see a "coming soon for your role" placeholder, plain Member
// sees nothing at all.
type Access = 'full' | 'soon' | 'none'

interface InsightsData {
  healthText: string
  activityText: string
  recommendationText: string
}

export default function AIOfficeInsights() {
  const { currentMembership } = useAuth()
  const role = currentMembership?.role
  const orgId = currentMembership?.organization.id

  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)

  const access: Access =
    role === 'admin' ? 'full' : role === 'trainer' || role === 'team_leader' ? 'soon' : 'none'

  useEffect(() => {
    if (access !== 'full' || !orgId) return
    let cancelled = false

    async function load(org: string) {
      setLoading(true)
      const now = Date.now()
      const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
      const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString()

      const [thisWeekRes, lastWeekRes, activeAttemptsRes, activeCourseworkRes, totalActiveRes, newMembersRes, upcomingOrientationRes] = await Promise.all([
        supabase.from('attempts').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'submitted').eq('is_guest', false).gte('submitted_at', sevenDaysAgo),
        supabase.from('attempts').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'submitted').eq('is_guest', false).gte('submitted_at', fourteenDaysAgo).lt('submitted_at', sevenDaysAgo),
        supabase.from('attempts').select('user_id').eq('org_id', org).eq('status', 'submitted').eq('is_guest', false).gte('submitted_at', sevenDaysAgo),
        supabase.from('coursework_submissions').select('user_id').eq('org_id', org).gte('submitted_at', sevenDaysAgo),
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active'),
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active').gte('joined_at', sevenDaysAgo),
        supabase.from('events').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('category', 'orientation').eq('status', 'scheduled').gte('start_at', new Date().toISOString()),
      ])
      if (cancelled) return

      const thisWeek = thisWeekRes.count ?? 0
      const lastWeek = lastWeekRes.count ?? 0
      let healthText: string
      if (thisWeek === 0 && lastWeek === 0) {
        healthText = 'No activity recorded yet this week.'
      } else if (lastWeek === 0) {
        healthText = `Office activity picked up this week — ${thisWeek} exam${thisWeek === 1 ? '' : 's'} completed, nothing to compare against last week.`
      } else {
        const pct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
        healthText = pct >= 0 ? `Office activity is up ${pct}% this week.` : `Office activity is down ${Math.abs(pct)}% this week.`
      }

      const activeUserIds = new Set<string>()
      for (const r of activeAttemptsRes.data ?? []) activeUserIds.add(r.user_id)
      for (const r of activeCourseworkRes.data ?? []) activeUserIds.add(r.user_id)
      const totalActive = totalActiveRes.count ?? 0
      const inactiveCount = Math.max(0, totalActive - activeUserIds.size)
      const activityText =
        totalActive === 0
          ? 'No members yet.'
          : inactiveCount > 0
            ? `${inactiveCount} member${inactiveCount === 1 ? '' : 's'} have had no activity in the last 7 days.`
            : 'Every member has been active in the last 7 days.'

      const newMembers = newMembersRes.count ?? 0
      const hasUpcomingOrientation = (upcomingOrientationRes.count ?? 0) > 0
      const recommendationText =
        newMembers === 0
          ? 'No urgent recommendations right now.'
          : hasUpcomingOrientation
            ? `${newMembers} new member${newMembers === 1 ? '' : 's'} joined this week — an Orientation Session is already scheduled.`
            : `${newMembers} new member${newMembers === 1 ? '' : 's'} joined this week — schedule an Orientation Session to help them get started.`

      if (!cancelled) {
        setData({ healthText, activityText, recommendationText })
        setLoading(false)
      }
    }

    load(orgId)
    return () => {
      cancelled = true
    }
  }, [access, orgId])

  if (access === 'none') return null

  if (access === 'soon') {
    return (
      <section className="ai-insights-panel">
        <div className="ai-insights-head">
          <h2>✨ AI Office Insights</h2>
          <span className="badge soon-badge">Soon</span>
        </div>
        <p style={{ color: 'var(--text-dim)', margin: 0 }}>Office-wide insights for your role are coming soon.</p>
      </section>
    )
  }

  return (
    <section className="ai-insights-panel">
      <div className="ai-insights-head">
        <h2>✨ AI Office Insights</h2>
      </div>

      <div className="ai-insight-grid">
        <div className="ai-insight-card">
          <span className="ai-insight-label">OFFICE HEALTH</span>
          <p>{loading ? 'Reading activity…' : data?.healthText}</p>
        </div>
        <div className="ai-insight-card">
          <span className="ai-insight-label">MEMBER ACTIVITY</span>
          <p>{loading ? 'Reading activity…' : data?.activityText}</p>
        </div>
        <div className="ai-insight-card">
          <span className="ai-insight-label">LEARNING INSIGHTS <span className="badge soon-badge">Soon</span></span>
          <p>—</p>
        </div>
        <div className="ai-insight-card">
          <span className="ai-insight-label">LEADERSHIP INSIGHTS <span className="badge soon-badge">Soon</span></span>
          <p>—</p>
        </div>
        <div className="ai-insight-card">
          <span className="ai-insight-label">BUSINESS INSIGHTS <span className="badge soon-badge">Soon</span></span>
          <p>—</p>
        </div>
        <div className="ai-insight-card">
          <span className="ai-insight-label">SMART RECOMMENDATIONS</span>
          <p>{loading ? 'Thinking…' : data?.recommendationText}</p>
        </div>
      </div>

      <div className="ai-insights-actions">
        <Link to="/invites" className="quick-action-btn">View Members</Link>
        <Link to="/reports" className="quick-action-btn">View Report</Link>
        <button type="button" className="quick-action-btn soon" disabled title="Coming soon">Send Reminder</button>
        <Link to="/events/new" className="quick-action-btn">+ Create Event</Link>
      </div>
    </section>
  )
}
