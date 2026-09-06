import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { loadMember360, member360Attention, type Member360 } from '../../lib/officeExtras'
import { moneyList } from '../../lib/finance'
import type { MemberMonthlyGoal } from '../../types/database'
import { STATUS_META as GOAL_STATUS_META, goalPercent } from '../../lib/goals'
import type { FreelanceProject, FreelanceProspect } from '../../lib/freelance'
import { PROJECT_STATUS, PROSPECT_STATUS } from '../../lib/freelance'

type Tab = 'overview' | 'business-path' | 'goals' | 'freelance'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'business-path', label: 'Business Path' },
  { id: 'goals', label: 'Goals' },
  { id: 'freelance', label: 'Freelance' },
]

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')

export default function MemberProfile360() {
  const { userId } = useParams<{ userId: string }>()
  const { currentMembership } = useAuth()
  const role = currentMembership?.role
  const orgId = currentMembership?.organization.id
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview') as Tab

  const [m, setM] = useState<Member360 | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!orgId || !userId) return
    setErr(null)
    loadMember360(orgId, userId).then(setM).catch((e) => setErr(e.message))
  }, [orgId, userId])
  useEffect(load, [load])

  if (role !== 'admin' && role !== 'team_leader') return <Navigate to="/" replace />

  if (err) {
    return (
      <div className="page">
        <Link to="/invites" className="rp-jump">← Members</Link>
        <h1>Member profile</h1>
        <div className="rp-error"><p>Could not load this member.</p><code className="rp-error-msg">{err}</code></div>
      </div>
    )
  }
  if (!m || !orgId || !userId) return <div className="page"><p className="empty-row">Loading…</p></div>

  const attention = member360Attention(m)
  const bal = moneyList((m.available_balance as { available?: { currency: string; amount: number }[] })?.available ?? [])

  return (
    <div className="page m360-page">
      <Link to="/invites" className="rp-jump">← Members</Link>
      <div className="m360-head">
        <div className="drawer-avatar" aria-hidden style={{ width: 52, height: 52 }}>
          {m.avatar_url ? <img src={m.avatar_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : m.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1>{m.name}</h1>
          <p className="rp-dim">
            {m.rank ?? 'No rank'} · {m.role} · <span className={`gl-tag ${m.membership_status === 'active' ? 'green' : 'muted'}`}>{m.membership_status}</span>
            {m.team ? ` · ${m.team}` : ''} · joined {fmt(m.joined_at)}
          </p>
        </div>
      </div>

      <div className="rp-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : ''} onClick={() => { params.set('tab', t.id); setParams(params, { replace: true }) }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="rp-metrics">
            <Metric label="Business Path" value={`${m.bp_percent}%`} sub={`${m.bp_required_done}/${m.bp_required_total} required`} />
            <Metric label="Goals this month" value={m.goals_this_month} sub={`${m.goals_done}/${m.goals_total} approved all-time`} />
            <Metric label="Direct members" value={m.direct_members} />
            <Metric label="Network prospects" value={m.prospects} sub={m.prospect_followups_overdue > 0 ? `${m.prospect_followups_overdue} overdue` : undefined} />
            <Metric label="Freelance clients" value={m.freelance_clients} sub={`${m.freelance_projects_open} open project${m.freelance_projects_open === 1 ? '' : 's'}`} />
            <Metric label="Verified freelance earnings" value={`₦${Number(m.freelance_verified_earnings).toLocaleString()}`} />
            <Metric label="Available balance" value={bal || '—'} />
            <Metric label="Exams passed" value={m.exams_passed} sub={`last active ${fmt(m.last_activity)}`} />
          </div>

          <section className="gl-drawer-sec">
            <h4>Needs Attention</h4>
            {attention.length === 0 ? (
              <p className="empty-row">Nothing flagged.</p>
            ) : (
              <ul className="m360-attn">{attention.map((a, i) => <li key={i}>{a}</li>)}</ul>
            )}
          </section>
        </>
      )}

      {tab === 'business-path' && (
        <section className="gl-drawer-sec">
          <h4>Current rank requirements ({m.bp_required_done}/{m.bp_required_total})</h4>
          {m.bp_items.length === 0 ? (
            <p className="empty-row">No requirements configured for this rank.</p>
          ) : (
            <ul className="rp-checklist">
              {m.bp_items.map((it, i) => (
                <li key={i} className={it.complete ? 'done' : ''}>
                  <span>{it.complete ? '✓' : '○'}</span> {it.title}{!it.required && <em> (optional)</em>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'goals' && <GoalsTab orgId={orgId} userId={userId} />}
      {tab === 'freelance' && <FreelanceTab orgId={orgId} userId={userId} />}
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rp-metric">
      <span className="rp-metric-label">{label}</span>
      <span className="rp-metric-value">{value}</span>
      <span className="rp-metric-sub">{sub ?? ' '}</span>
    </div>
  )
}

function GoalsTab({ orgId, userId }: { orgId: string; userId: string }) {
  const [rows, setRows] = useState<MemberMonthlyGoal[] | null>(null)
  useEffect(() => {
    supabase.from('member_monthly_goals').select('*').eq('org_id', orgId).eq('user_id', userId)
      .order('month', { ascending: false }).order('created_at', { ascending: false })
      .then(({ data }) => setRows((data as MemberMonthlyGoal[]) ?? []))
  }, [orgId, userId])
  if (!rows) return <p className="empty-row">Loading…</p>
  if (rows.length === 0) return <p className="empty-row">No goals yet.</p>
  return (
    <div className="rp-table-wrap">
      <table className="rp-table">
        <thead><tr><th>Goal</th><th>Period</th><th>Progress</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <td>{g.title}</td>
              <td className="rp-dim">{g.month}</td>
              <td className="rp-dim">{goalPercent(g)}%</td>
              <td><span className={`gl-tag ${GOAL_STATUS_META[g.status].tone}`}>{GOAL_STATUS_META[g.status].label}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FreelanceTab({ orgId, userId }: { orgId: string; userId: string }) {
  const [d, setD] = useState<{ prospects: FreelanceProspect[]; projects: FreelanceProject[] } | null>(null)
  useEffect(() => {
    Promise.all([
      supabase.from('freelance_prospects').select('*').eq('org_id', orgId).eq('member_id', userId).order('created_at', { ascending: false }),
      supabase.from('freelance_projects').select('*').eq('org_id', orgId).eq('member_id', userId).order('created_at', { ascending: false }),
    ]).then(([p, pr]) => setD({ prospects: (p.data as FreelanceProspect[]) ?? [], projects: (pr.data as FreelanceProject[]) ?? [] }))
  }, [orgId, userId])
  if (!d) return <p className="empty-row">Loading…</p>
  return (
    <>
      <section className="gl-drawer-sec">
        <h4>Prospects ({d.prospects.length})</h4>
        {d.prospects.length === 0 ? <p className="empty-row">None.</p> : (
          <div className="rp-table-wrap"><table className="rp-table">
            <thead><tr><th>Name</th><th>Platform</th><th>Status</th></tr></thead>
            <tbody>{d.prospects.map((p) => (
              <tr key={p.id}><td>{p.name}</td><td className="rp-dim">{p.platform ?? '—'}</td>
                <td><span className={`gl-tag ${PROSPECT_STATUS.find((s) => s.id === p.status)?.tone}`}>{PROSPECT_STATUS.find((s) => s.id === p.status)?.label}</span></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <section className="gl-drawer-sec">
        <h4>Projects ({d.projects.length})</h4>
        {d.projects.length === 0 ? <p className="empty-row">None.</p> : (
          <div className="rp-table-wrap"><table className="rp-table">
            <thead><tr><th>Project</th><th>Value</th><th>Due</th><th>Status</th><th>Finance</th></tr></thead>
            <tbody>{d.projects.map((p) => (
              <tr key={p.id}><td>{p.title}</td><td className="rp-dim">{p.order_value ? `${p.currency ?? '₦'} ${Number(p.order_value).toLocaleString()}` : '—'}</td>
                <td className="rp-dim">{p.due_date ? new Date(p.due_date).toLocaleDateString() : '—'}</td>
                <td><span className={`gl-tag ${PROJECT_STATUS.find((s) => s.id === p.status)?.tone}`}>{PROJECT_STATUS.find((s) => s.id === p.status)?.label}</span></td>
                <td className="rp-dim">{p.finance_order_id ? 'Linked' : '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  )
}
