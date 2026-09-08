import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import type { MemberMonthlyGoal } from '../../types/database'
import {
  CATEGORY_META,
  STATUS_META,
  formatValue,
  goalPercent,
  goalRpc,
  monthLabelOf,
} from '../../lib/goals'

interface Row extends MemberMonthlyGoal {
  member_name: string
}

function progressText(g: MemberMonthlyGoal): string {
  if (g.goal_type === 'binary') return g.done ? 'Complete' : 'Incomplete'
  return `${formatValue(g.goal_type, g.progress_value, g.unit)} / ${formatValue(g.goal_type, g.target_value, g.unit)} (${goalPercent(g)}%)`
}

export default function GoalsReview() {
  const { currentMembership } = useAuth()
  const role = currentMembership?.role
  const orgId = currentMembership?.organization.id

  const [tab, setTab] = useState<'queue' | 'all'>('queue')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [monthFilter, setMonthFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    let q = supabase
      .from('member_monthly_goals')
      .select('*, profile:profiles!member_monthly_goals_user_id_fkey(full_name)')
      .eq('org_id', orgId)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
    if (tab === 'queue') q = q.eq('status', 'submitted')
    const { data, error: e } = await q
    if (e) setError(e.message)
    const mapped = ((data as unknown as (MemberMonthlyGoal & { profile: { full_name: string } | null })[]) ?? []).map((g) => ({
      ...g,
      member_name: g.profile?.full_name ?? 'Unknown',
    }))
    setRows(mapped)
    setLoading(false)
  }, [orgId, tab])

  useEffect(() => { load() }, [load])

  const open = rows.find((r) => r.id === openId) ?? null
  const months = useMemo(() => [...new Set(rows.map((r) => r.month))].sort().reverse(), [rows])
  const visible = rows.filter(
    (r) => (!monthFilter || r.month === monthFilter) && (!statusFilter || r.status === statusFilter),
  )

  // All Goals view: one section per member, members A→Z, submissions first.
  const byMember = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of visible) {
      const list = map.get(r.member_name) ?? []
      list.push(r)
      map.set(r.member_name, list)
    }
    return [...map.entries()]
      .map(([name, goals]) => ({
        name,
        goals: [...goals].sort(
          (a, b) =>
            (b.status === 'submitted' ? 1 : 0) - (a.status === 'submitted' ? 1 : 0) ||
            b.month.localeCompare(a.month) ||
            b.created_at.localeCompare(a.created_at),
        ),
        awaiting: goals.filter((g) => g.status === 'submitted').length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [visible])

  if (role !== 'admin' && role !== 'team_leader') return <Navigate to="/" replace />

  async function review(decision: 'approve' | 'changes' | 'reject', note: string) {
    if (!open) return
    setBusy(true)
    setError(null)
    const { error: e } = await goalRpc.review(open.id, decision, note)
    setBusy(false)
    if (e) setError(e.message)
    else {
      setOpenId(null)
      load()
    }
  }

  return (
    <div className="page gl-page">
      <div className="gl-head">
        <div>
          <h1>Goals Review</h1>
          <p>Review member goal submissions and browse everyone's goals for the office.</p>
        </div>
      </div>

      <div className="gl-planswitch">
        <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>
          Review Queue{rows.length > 0 && tab === 'queue' ? ` · ${rows.length}` : ''}
        </button>
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>All Goals</button>
      </div>

      {tab === 'all' && (
        <div className="gl-filters">
          <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
            <option value="">All periods</option>
            {months.map((m) => <option key={m} value={m}>{monthLabelOf(m)}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {loading ? (
        <p className="empty-row">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="empty-row">{tab === 'queue' ? 'No submissions awaiting review.' : 'No goals match.'}</p>
      ) : tab === 'queue' ? (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead>
              <tr><th>Member</th><th>Goal</th><th>Period</th><th>Progress</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {visible.map((g) => (
                <tr key={g.id}>
                  <td>{g.member_name}</td>
                  <td>{g.category && <span aria-hidden>{CATEGORY_META[g.category].icon} </span>}{g.title}</td>
                  <td className="rp-dim">{monthLabelOf(g.month)}</td>
                  <td className="rp-dim">{progressText(g)}</td>
                  <td><span className={`gl-tag ${STATUS_META[g.status].tone}`}>{STATUS_META[g.status].label}</span></td>
                  <td><button className="gl-btn ghost sm" onClick={() => setOpenId(g.id)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="gl-mgroups">
          {byMember.map((m) => (
            <div className="gl-mgroup" key={m.name}>
              <div className="gl-mgroup-head">
                <strong>{m.name}</strong>
                <span className="gl-mgroup-meta">
                  {m.goals.length} goal{m.goals.length === 1 ? '' : 's'}
                  {m.awaiting > 0 && <span className="gl-tag amber" style={{ marginLeft: 8 }}>{m.awaiting} to review</span>}
                </span>
              </div>
              <div className="rp-table-wrap">
                <table className="rp-table">
                  <thead>
                    <tr><th>Goal</th><th>Period</th><th>Progress</th><th>Status</th><th /></tr>
                  </thead>
                  <tbody>
                    {m.goals.map((g) => (
                      <tr key={g.id}>
                        <td>{g.category && <span aria-hidden>{CATEGORY_META[g.category].icon} </span>}{g.title}</td>
                        <td className="rp-dim">{monthLabelOf(g.month)}</td>
                        <td className="rp-dim">{progressText(g)}</td>
                        <td><span className={`gl-tag ${STATUS_META[g.status].tone}`}>{STATUS_META[g.status].label}</span></td>
                        <td><button className="gl-btn ghost sm" onClick={() => setOpenId(g.id)}>{g.status === 'submitted' ? 'Review' : 'View'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && <ReviewDrawer goal={open} busy={busy} onClose={() => setOpenId(null)} onReview={review} />}
    </div>
  )
}

function ReviewDrawer({
  goal,
  busy,
  onClose,
  onReview,
}: {
  goal: Row
  busy: boolean
  onClose: () => void
  onReview: (decision: 'approve' | 'changes' | 'reject', note: string) => void
}) {
  const [note, setNote] = useState('')
  const cat = goal.category ? CATEGORY_META[goal.category] : null
  const canReview = goal.status === 'submitted'

  return (
    <>
      <div className="drawer-overlay open" onClick={onClose} />
      <div className="drawer open gl-drawer">
        <button type="button" className="drawer-close" onClick={onClose}>✕</button>
        <div className="drawer-head">
          <div className="drawer-avatar" aria-hidden>{cat?.icon ?? '🎯'}</div>
          <div>
            <h3>{goal.title}</h3>
            <p>{goal.member_name} · {monthLabelOf(goal.month)}</p>
          </div>
        </div>

        {goal.description && <p className="gl-drawer-desc">{goal.description}</p>}

        <div className="gl-drawer-sec">
          <h4>Details</h4>
          <ul className="gl-timeline">
            <li><span>Category</span><strong>{cat?.label ?? '—'}</strong></li>
            <li><span>Target</span><strong>{goal.goal_type === 'binary' ? 'Complete' : formatValue(goal.goal_type, goal.target_value, goal.unit)}</strong></li>
            <li><span>Final progress</span><strong>{goal.goal_type === 'binary' ? (goal.done ? 'Complete' : 'Incomplete') : `${formatValue(goal.goal_type, goal.progress_value, goal.unit)} (${goalPercent(goal)}%)`}</strong></li>
            {goal.submitted_at && <li><span>Submitted</span><strong>{new Date(goal.submitted_at).toLocaleDateString()}</strong></li>}
            <li><span>Status</span><strong>{STATUS_META[goal.status].label}</strong></li>
          </ul>
          {goal.submission_note && <p className="gl-sub-note"><strong>Member note:</strong> {goal.submission_note}</p>}
          {goal.evidence_url && <p className="gl-sub-note"><a href={goal.evidence_url} target="_blank" rel="noreferrer">Evidence link ↗</a></p>}
          {goal.review_note && <p className="gl-review-note warn"><strong>Last review:</strong> {goal.review_note}</p>}
        </div>

        {canReview ? (
          <div className="gl-drawer-sec">
            <h4>Review note (optional)</h4>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Feedback for the member…" />
            <div className="gl-drawer-actions">
              <button type="button" className="gl-btn" disabled={busy} onClick={() => onReview('approve', note)}>Approve</button>
              <button type="button" className="gl-btn ghost" disabled={busy} onClick={() => onReview('changes', note)}>Request Changes</button>
              <button type="button" className="gl-btn ghost danger" disabled={busy} onClick={() => onReview('reject', note)}>Reject</button>
            </div>
          </div>
        ) : (
          <p className="gl-sub-note">This goal isn't awaiting review.</p>
        )}
      </div>
    </>
  )
}
