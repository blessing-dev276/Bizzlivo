import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { healUserAttempts } from '../lib/examLifecycle'
import AIOfficeInsights from '../components/AIOfficeInsights'
import RecentActivity from '../components/RecentActivity'
import type { Exam } from '../types/database'

const ADMIN_ROLES = new Set(['admin', 'trainer'])
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
// {slug}.hq360.space — a wildcard DNS record + Cloudflare Worker route this
// to the same Firebase-hosted app for any office, so this is always shown
// this way regardless of which host (hq360.space, hq360-cbt.web.app, ...)
// the admin happens to be viewing the dashboard from.
const OFFICE_URL_ROOT_DOMAIN = 'hq360.space'

interface AdminStats {
  memberCount: number
  invitedCount: number
  examCount: number
  publishedCount: number
  resourceCount: number
  pendingReviewCount: number
  pendingNotifications: number
  recentExams: Exam[]
  memberInitials: string[]
  weekCounts: number[]
  weekTotal: number
  peakDayLabel: string | null
  totalMembers: number
  membersJoinedThisMonth: number
  trainerCount: number
  newMembersThisWeek: number
  assignmentCount: number
  completedAssignmentCount: number
}

interface MemberStats {
  assignedCount: number
  completedCount: number
  passRate: number | null
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name[0]?.toUpperCase() || '?'
}

function timeOfDayGreeting(date: Date) {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function OfficeLoginLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false)
  const url = `https://${slug}.${OFFICE_URL_ROOT_DOMAIN}`

  function copy() {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <p style={{ fontSize: 12.5, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 10 }}>
      Your team's login page: <span style={{ color: 'var(--text-dim)' }}>{url}</span>{' '}
      <button
        type="button"
        className="secondary"
        onClick={copy}
        style={{ padding: '2px 8px', fontSize: 11.5, marginLeft: 4 }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </p>
  )
}

export default function Dashboard() {
  const { profile, currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false
  const orgId = currentMembership?.organization.id

  const [loading, setLoading] = useState(true)
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null)
  const [memberStats, setMemberStats] = useState<MemberStats | null>(null)
  const [now, setNow] = useState(new Date())
  const [aiSummary, setAiSummary] = useState<{ text: string; loading: boolean; error: string | null }>({
    text: '',
    loading: true,
    error: null,
  })

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!isAdmin || !orgId) return
    let cancelled = false
    setAiSummary({ text: '', loading: true, error: null })
    supabase.functions.invoke('dashboard-ai-summary', { body: { orgId } }).then(({ data, error }) => {
      if (cancelled) return
      if (error || data?.error) {
        setAiSummary({ text: '', loading: false, error: data?.error ?? 'Could not load AI summary.' })
        return
      }
      setAiSummary({ text: data.summary, loading: false, error: null })
    })
    return () => {
      cancelled = true
    }
  }, [isAdmin, orgId])

  useEffect(() => {
    if (!orgId) return
    let cancelled = false

    async function loadAdmin(org: string) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)

      const [
        membersRes,
        invitedRes,
        examsRes,
        publishedRes,
        resourcesRes,
        pendingRes,
        recentExamsRes,
        memberProfilesRes,
        weekAttemptsRes,
        pendingNotificationsRes,
        totalMembersRes,
        membersJoinedThisMonthRes,
        trainerCountRes,
        newMembersThisWeekRes,
        assignmentCountRes,
        completedAssignmentCountRes,
      ] = await Promise.all([
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active'),
        supabase.from('invites').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'pending'),
        supabase.from('exams').select('id', { count: 'exact', head: true }).eq('org_id', org),
        supabase.from('exams').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'published'),
        supabase.from('resources').select('id', { count: 'exact', head: true }).eq('org_id', org),
        supabase.from('questions').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'pending_review'),
        supabase.from('exams').select('*').eq('org_id', org).order('created_at', { ascending: false }).limit(5),
        supabase
          .from('memberships')
          .select('profile:profiles(full_name)')
          .eq('org_id', org)
          .eq('status', 'active')
          .order('joined_at', { ascending: false })
          .limit(5),
        supabase
          .from('attempts')
          .select('submitted_at')
          .eq('org_id', org)
          .eq('status', 'submitted')
          .gte('submitted_at', sevenDaysAgo),
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', org)
          .eq('user_id', profile?.id ?? '')
          .is('read_at', null),
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org),
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).gte('joined_at', monthStart.toISOString()),
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active').eq('role', 'trainer'),
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active').gte('joined_at', sevenDaysAgo),
        supabase.from('exam_assignments').select('id', { count: 'exact', head: true }).eq('org_id', org),
        supabase.from('attempts').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'submitted').eq('is_guest', false),
      ])

      if (cancelled) return

      const weekCounts = new Array(7).fill(0) as number[]
      for (const row of weekAttemptsRes.data ?? []) {
        if (!row.submitted_at) continue
        weekCounts[new Date(row.submitted_at).getDay()] += 1
      }
      const weekTotal = weekCounts.reduce((a, b) => a + b, 0)
      const peakIdx = weekCounts.indexOf(Math.max(...weekCounts))
      const peakDayLabel = weekTotal > 0 ? WEEKDAY_LABELS[peakIdx] : null

      const memberInitials = ((memberProfilesRes.data as unknown as { profile: { full_name: string } | null }[]) ?? [])
        .map((m) => (m.profile ? initialsOf(m.profile.full_name) : '?'))

      setAdminStats({
        memberCount: membersRes.count ?? 0,
        invitedCount: invitedRes.count ?? 0,
        examCount: examsRes.count ?? 0,
        publishedCount: publishedRes.count ?? 0,
        resourceCount: resourcesRes.count ?? 0,
        pendingReviewCount: pendingRes.count ?? 0,
        pendingNotifications: pendingNotificationsRes.count ?? 0,
        totalMembers: totalMembersRes.count ?? 0,
        membersJoinedThisMonth: membersJoinedThisMonthRes.count ?? 0,
        trainerCount: trainerCountRes.count ?? 0,
        newMembersThisWeek: newMembersThisWeekRes.count ?? 0,
        assignmentCount: assignmentCountRes.count ?? 0,
        completedAssignmentCount: completedAssignmentCountRes.count ?? 0,
        recentExams: (recentExamsRes.data as Exam[]) ?? [],
        memberInitials,
        weekCounts,
        weekTotal,
        peakDayLabel,
      })
    }

    async function loadMember(org: string, userId: string) {
      // Reconcile stale in-progress/missed attempts first — otherwise a
      // self-healed "expired" attempt (e.g. an abandoned exam-link exam,
      // which has no exam_assignments row at all) would never surface here.
      await healUserAttempts(org, userId)

      const [assignedRes, attemptsRes] = await Promise.all([
        supabase.from('exam_assignments').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('assigned_to_user', userId),
        supabase.from('attempts').select('passed').eq('org_id', org).eq('user_id', userId).in('status', ['submitted', 'expired']),
      ])
      if (cancelled) return
      const submitted = attemptsRes.data ?? []
      const passRate = submitted.length > 0 ? Math.round((submitted.filter((a) => a.passed).length / submitted.length) * 100) : null
      setMemberStats({
        assignedCount: assignedRes.count ?? 0,
        completedCount: submitted.length,
        passRate,
      })
    }

    setLoading(true)
    const task = isAdmin ? loadAdmin(orgId) : loadMember(orgId, profile?.id ?? '')
    task.then(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [orgId, isAdmin, profile?.id])

  const setupSteps = useMemo(() => {
    if (!adminStats) return { done: 0, total: 3, percent: 0 }
    const flags = [adminStats.resourceCount > 0, adminStats.publishedCount > 0, adminStats.memberCount > 1]
    const done = flags.filter(Boolean).length
    return { done, total: 3, percent: Math.round((done / 3) * 100) }
  }, [adminStats])

  const gaugeCircumference = 2 * Math.PI * 54
  const gaugeOffset = gaugeCircumference * (1 - setupSteps.percent / 100)

  if (!currentMembership) {
    return (
      <div className="page">
        <h1>No office found</h1>
        <p>You're not a member of any office yet.</p>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="page">
        <section className="hero">
          <div className="blob blob-a" />
          <div className="blob blob-b" />
          <div className="hero-inner">
            <h1>Welcome back, {profile?.full_name?.split(' ')[0] ?? 'there'}.</h1>
            <p className="sub">Here's what's assigned to you at {currentMembership.organization.name}.</p>
          </div>
        </section>

        <section className="kpi-strip kpi-strip-3">
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">ASSIGNED EXAMS</span></div>
            <div className="kpi-value">{loading ? '—' : memberStats?.assignedCount ?? 0}</div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">COMPLETED</span></div>
            <div className="kpi-value">{loading ? '—' : memberStats?.completedCount ?? 0}</div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">PASS RATE</span></div>
            <div className="kpi-value">{loading || memberStats?.passRate === null ? '—' : `${memberStats?.passRate}%`}</div>
          </div>
        </section>

        <AIOfficeInsights />
        <RecentActivity />

        <div className="bento">
          <Link to="/cbt" className="tile" style={{ gridColumn: 'span 12' }}>
            <div className="t-setup-copy">
              <h3>My Exams</h3>
              <p>See exams assigned to you, take them, and check your results.</p>
              <span className="btn-primary-link">Go to My Exams →</span>
            </div>
          </Link>
        </div>
      </div>
    )
  }

  const stats = adminStats
  const maxBar = stats ? Math.max(1, ...stats.weekCounts) : 1
  const isEmptyOffice = !loading && setupSteps.done === 0
  const activePercent = stats && stats.totalMembers > 0 ? Math.round((stats.memberCount / stats.totalMembers) * 100) : null
  const completionRate = stats && stats.assignmentCount > 0
    ? Math.min(100, Math.round((stats.completedAssignmentCount / stats.assignmentCount) * 100))
    : null

  return (
    <div className="page">
      <section className="hero">
        <div className="blob blob-a" />
        <div className="blob blob-b" />
        <div className="hero-inner">
          <div className="hero-top-row">
            <span className="hero-datetime">
              {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          </div>
          <h1>{timeOfDayGreeting(now)}, {profile?.full_name?.split(' ')[0] ?? 'there'}.</h1>
          <p className="sub">
            Welcome back to {currentMembership.organization.name} Virtual Office.{' '}
            {setupSteps.done < setupSteps.total
              ? `${setupSteps.total - setupSteps.done} step${setupSteps.total - setupSteps.done === 1 ? '' : 's'} left before it's fully set up.`
              : `Here's what's happening.`}
          </p>
          <OfficeLoginLink slug={currentMembership.organization.slug} />

          <div className="ai-welcome">
            <span className="ai-welcome-icon">✨</span>
            {aiSummary.loading ? (
              <span className="ai-welcome-text ai-welcome-loading">Reading today's activity…</span>
            ) : aiSummary.error ? (
              <span className="ai-welcome-text ai-welcome-loading">AI summary unavailable right now.</span>
            ) : (
              <span className="ai-welcome-text">{aiSummary.text}</span>
            )}
          </div>
        </div>
      </section>

      {isEmptyOffice ? (
        <section className="empty-office-card">
          <h2>Welcome to your new Virtual Office!</h2>
          <p>Start by inviting your first members or uploading your first training.</p>
          <div className="empty-office-actions">
            <Link to="/invites" className="btn-primary-link">Invite Members</Link>
            <Link to="/exams" className="btn-primary-link">Upload Training</Link>
          </div>
        </section>
      ) : (
      <>
      <section className="today-summary">
        <div className="summary-chip">
          <span className="summary-label">PENDING NOTIFICATIONS</span>
          <span className="summary-value">{loading ? '—' : stats?.pendingNotifications ?? 0}</span>
        </div>
        <div className="summary-chip soon">
          <span className="summary-label">MEMBERS ACTIVE TODAY</span>
          <span className="badge soon-badge">Soon</span>
        </div>
        <div className="summary-chip soon">
          <span className="summary-label">UPCOMING EVENT</span>
          <span className="badge soon-badge">Soon</span>
        </div>
      </section>

      <section className="quick-actions">
        <Link to="/invites" className="quick-action-btn">+ Invite Member</Link>
        <Link to="/exams" className="quick-action-btn">+ Upload Training</Link>
        <Link to="/events/new" className="quick-action-btn">+ Create Event</Link>
        <button type="button" className="quick-action-btn soon" disabled title="Coming soon">+ Make Announcement</button>
      </section>

      <AIOfficeInsights />
      <RecentActivity />

      <section className="overview-wrap">
        <h4 className="overview-heading">OFFICE OVERVIEW</h4>
        <div className="overview-grid">
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">TOTAL MEMBERS</span></div>
            <div className="kpi-value">{loading ? '—' : stats?.totalMembers ?? 0}</div>
            {!loading && (stats?.membersJoinedThisMonth ?? 0) > 0 && (
              <div className="kpi-delta">+{stats?.membersJoinedThisMonth} this month</div>
            )}
          </div>
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">ACTIVE MEMBERS</span></div>
            <div className="kpi-value">{loading ? '—' : stats?.memberCount ?? 0}</div>
            {!loading && activePercent !== null && <div className="kpi-delta">{activePercent}% of total</div>}
          </div>
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">TRAINERS</span></div>
            <div className="kpi-value">{loading ? '—' : stats?.trainerCount ?? 0}</div>
          </div>
          <div className="kpi">
            <div className="kpi-top">
              <span className="kpi-label">TEAM LEADERS</span>
              <span className="badge soon-badge">Soon</span>
            </div>
            <div className="kpi-value">—</div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">NEW MEMBERS THIS WEEK</span></div>
            <div className="kpi-value">{loading ? '—' : stats?.newMembersThisWeek ?? 0}</div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">TRAINING COMPLETION</span></div>
            <div className="kpi-value">{loading || completionRate === null ? '—' : `${completionRate}%`}</div>
          </div>
          <div className="kpi">
            <div className="kpi-top">
              <span className="kpi-label">OFFICE HEALTH</span>
              <span className="badge soon-badge">Soon</span>
            </div>
            <div className="kpi-value">—</div>
          </div>
          <div className="kpi">
            <div className="kpi-top">
              <span className="kpi-label">AI INSIGHTS</span>
              <span className="badge soon-badge">Soon</span>
            </div>
            <div className="kpi-value">—</div>
          </div>
        </div>
      </section>

      <section className="kpi-strip kpi-strip-3">
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">EXAMS PUBLISHED</span></div>
          <div className="kpi-value">{loading ? '—' : stats?.publishedCount ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">RESOURCES</span></div>
          <div className="kpi-value">{loading ? '—' : stats?.resourceCount ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-top"><span className="kpi-label">PENDING REVIEW</span></div>
          <div className="kpi-value">{loading ? '—' : stats?.pendingReviewCount ?? 0}</div>
        </div>
      </section>

      <section className="bento">
        <div className="tile t-setup">
          <div className="gauge-wrap">
            <svg viewBox="0 0 120 120">
              <circle className="gauge-track" cx="60" cy="60" r="54" />
              <circle
                className="gauge-progress"
                cx="60"
                cy="60"
                r="54"
                strokeDasharray={gaugeCircumference}
                strokeDashoffset={loading ? gaugeCircumference : gaugeOffset}
              />
            </svg>
            <div className="gauge-center">
              <div className="gauge-number">{loading ? '—' : `${setupSteps.percent}%`}</div>
              <div className="gauge-label">{setupSteps.done} OF {setupSteps.total}</div>
            </div>
          </div>
          <div className="t-setup-copy">
            <h3>Setup progress</h3>
            <p>
              {setupSteps.done >= setupSteps.total
                ? 'Resource uploaded, exam published, team invited. You\'re all set.'
                : 'Upload a resource, publish an exam, and invite your team to finish setup.'}
            </p>
            <Link to="/onboarding" className="btn-primary-link">Continue setup →</Link>
          </div>
        </div>

        <div className="tile t-chart">
          <div className="tile-head">
            <h4>EXAM ATTEMPTS · LAST 7 DAYS</h4>
            <div className="tile-icon">
              <svg viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></svg>
            </div>
          </div>
          <div className="chart-bars">
            {(stats?.weekCounts ?? new Array(7).fill(0)).map((count, idx) => {
              const dayIdx = (new Date().getDay() - 6 + idx + 7) % 7
              return (
                <div className="bar-col" key={idx}>
                  <div className="bar" style={{ height: `${Math.max(4, (count / maxBar) * 100)}%` }} />
                  <span className="bar-day">{WEEKDAY_LABELS[dayIdx]}</span>
                </div>
              )
            })}
          </div>
          <div className="chart-foot">
            <span>{stats?.weekTotal ?? 0} total attempts</span>
            <span>{stats?.peakDayLabel ? `Peak: ${stats.peakDayLabel}` : 'No attempts yet'}</span>
          </div>
        </div>

        <Link to="/exams" className="tile t-resources">
          <div className="tile-head">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
            </div>
          </div>
          <div className="stat-big">{loading ? '—' : stats?.resourceCount ?? 0}</div>
          <p className="desc">Resources uploaded. Manage them from a new exam anytime.</p>
        </Link>

        <div className="tile t-exams">
          <div className="tile-head">
            <h4>RECENT EXAMS</h4>
            <div className="tile-icon">
              <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>
            </div>
          </div>
          {loading ? (
            <p className="empty-row">Loading…</p>
          ) : stats && stats.recentExams.length > 0 ? (
            stats.recentExams.map((exam) => (
              <Link key={exam.id} to={`/exams/${exam.id}`} className="exam-row" style={{ color: 'inherit' }}>
                <span className="exam-name">{exam.title}</span>
                <span className={`status-pill status-${exam.status}`}>
                  {exam.status.toUpperCase()}
                </span>
              </Link>
            ))
          ) : (
            <p className="empty-row">No exams yet.</p>
          )}
        </div>

        <Link to="/invites" className="tile t-team">
          <div className="tile-head">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
          </div>
          <div className="avatar-stack">
            {(stats?.memberInitials ?? []).map((init, idx) => (
              <div className="avatar" key={idx}>{init}</div>
            ))}
          </div>
          <p className="desc">{stats?.memberCount ?? 0} active · {stats?.invitedCount ?? 0} invited</p>
        </Link>
      </section>
      </>
      )}
    </div>
  )
}
