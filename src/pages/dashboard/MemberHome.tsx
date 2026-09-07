import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { localDateString } from '../../lib/date'
import { useAuth } from '../../lib/AuthContext'
import { healUserAttempts } from '../../lib/examLifecycle'
import {
  loadPathState,
  promoteMember,
  selfConfirmItem,
  submitForApproval,
  unconfirmItem,
  type PathItemState,
  type PathState,
} from '../../lib/businessPath'
import RecentActivity from '../../components/RecentActivity'
import TodayActionCenter from './TodayActionCenter'
import OfficeActivityFeed from '../../components/OfficeActivityFeed'
import { DashboardSkeleton } from '../../components/AppSkeleton'
import { timeOfDayGreeting } from './dashboardShared'
import { loadMemberBalances, moneyList } from '../../lib/finance'
import type { MoneyByCurrency } from '../../types/database'

const FOLLOW_UP_STALE_DAYS = 3
const WON_OR_LOST = new Set(['won_customer', 'won_distributor', 'lost'])

interface NetworkSnapshot {
  direct: number
  followUpsDue: number
  followUpName: string | null
}
interface Upcoming {
  key: string
  title: string
  when: string
  href: string
}

// ---------- small pieces ----------
const StepIcon = {
  done: (
    <svg viewBox="0 0 24 24" aria-hidden><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z" opacity=".18" /><polyline points="7 12.5 10.5 16 17 8.5" /></svg>
  ),
  current: (
    <svg viewBox="0 0 24 24" aria-hidden><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></svg>
  ),
  locked: (
    <svg viewBox="0 0 24 24" aria-hidden><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
  ),
} as const

function Ring({ percent, size = 92 }: { percent: number; size?: number }) {
  const r = size / 2 - 7
  const c = 2 * Math.PI * r
  return (
    <div className="mrk-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle className="trk" cx={size / 2} cy={size / 2} r={r} />
        <circle className="prg" cx={size / 2} cy={size / 2} r={r} strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} />
      </svg>
      <span className="mrk-ring-num">{percent}%</span>
    </div>
  )
}

function StatusDot({ status }: { status: PathItemState['status'] }) {
  if (status === 'complete') return <span className="mrk-dot done"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></span>
  if (status === 'in_progress') return <span className="mrk-dot part" />
  if (status === 'awaiting_approval') return <span className="mrk-dot wait" />
  if (status === 'rejected' || status === 'changes_requested') return <span className="mrk-dot attn" />
  return <span className="mrk-dot none" />
}

function statusLabel(s: PathItemState): string {
  switch (s.status) {
    case 'complete': return s.item.validation_mode === 'manual' ? 'Approved' : 'Automatically completed'
    case 'awaiting_approval': return 'Awaiting approval'
    case 'rejected': return 'Rejected — resubmit'
    case 'changes_requested': return 'Changes requested'
    case 'in_progress': return s.target > 1 ? `${s.current} / ${s.target}` : 'In progress'
    default: return s.target > 1 ? `0 / ${s.target}` : 'Not started'
  }
}

function RequirementRow({
  s,
  orgId,
  userId,
  onChange,
}: {
  s: PathItemState
  orgId: string
  userId: string
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const canSelfConfirm = s.item.validation_mode !== 'manual' && ['manual_self', 'resource', 'link'].includes(s.item.kind)
  const canSubmit = s.item.validation_mode === 'manual' && !['manual_admin'].includes(s.item.kind)
    && (s.status === 'not_started' || s.status === 'rejected' || s.status === 'changes_requested')

  async function act() {
    setBusy(true)
    if (canSelfConfirm) {
      if (s.complete) await unconfirmItem(userId, s.item.id)
      else await selfConfirmItem(orgId, userId, s.item.id)
    } else if (canSubmit) {
      await submitForApproval(orgId, userId, s.item.id)
    }
    setBusy(false)
    onChange()
  }

  const pct = s.target > 1 ? Math.round((s.current / s.target) * 100) : s.complete ? 100 : 0

  return (
    <div className={`mrk-req ${s.status}`}>
      <StatusDot status={s.status} />
      <div className="mrk-req-body">
        <div className="mrk-req-title">
          {s.item.title}
          {!s.item.is_required && <span className="mrk-optional">optional</span>}
        </div>
        <div className="mrk-req-meta">
          <span>{statusLabel(s)}</span>
          <span className="mrk-req-mode">{s.item.validation_mode === 'manual' ? 'Manual' : 'Auto'}</span>
        </div>
        {s.target > 1 && !s.complete && <span className="mrk-req-bar"><i style={{ width: `${pct}%` }} /></span>}
      </div>
      <div className="mrk-req-actions">
        {(canSelfConfirm || canSubmit) && (
          <button type="button" className="btn-ghost" onClick={act} disabled={busy}>
            {canSelfConfirm ? (s.complete ? 'Undo' : 'Mark done') : 'Submit'}
          </button>
        )}
        {s.href && !s.complete && (
          s.href.startsWith('http')
            ? <a className="mrk-req-link" href={s.href} target="_blank" rel="noreferrer">Open →</a>
            : <Link className="mrk-req-link" to={s.href}>Open →</Link>
        )}
      </div>
    </div>
  )
}

function ReportModal({ orgId, userId, onClose, onSaved }: { orgId: string; userId: string; onClose: () => void; onSaved: () => void }) {
  const [summary, setSummary] = useState('')
  const [wins, setWins] = useState('')
  const [blockers, setBlockers] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!summary.trim()) return
    setBusy(true)
    const { error: e1 } = await supabase.from('member_daily_reports').upsert(
      { org_id: orgId, user_id: userId, report_on: localDateString(), summary: summary.trim(), wins: wins.trim() || null, blockers: blockers.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,user_id,report_on' },
    )
    setBusy(false)
    if (e1) { setError(e1.message); return }
    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={save}>
          <h2>Today's report</h2>
          <label>What did you get done today?<textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} required autoFocus /></label>
          <label>Wins (optional)<input value={wins} onChange={(e) => setWins(e.target.value)} /></label>
          <label>Blockers (optional)<input value={blockers} onChange={(e) => setBlockers(e.target.value)} /></label>
          {error && <p className="form-error">{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={busy || !summary.trim()}>{busy ? 'Saving…' : 'Save report'}</button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------- main ----------
export default function MemberHome() {
  const { profile, currentMembership } = useAuth()
  const navigate = useNavigate()
  const orgId = currentMembership?.organization.id
  const userId = profile?.id
  const now = useMemo(() => new Date(), [])
  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

  const [path, setPath] = useState<PathState | null>(null)
  const [net, setNet] = useState<NetworkSnapshot>({ direct: 0, followUpsDue: 0, followUpName: null })
  const [upcoming, setUpcoming] = useState<Upcoming[]>([])
  const [wallet, setWallet] = useState<{ available: MoneyByCurrency[]; pending: MoneyByCurrency[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [reqFilter, setReqFilter] = useState<'all' | 'learning' | 'task'>('all')
  const [reportOpen, setReportOpen] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const autoTried = useRef<string | null>(null)

  const reload = useCallback(async () => {
    if (!orgId || !userId) return
    // Self-heal in the background — it must never delay first paint.
    void healUserAttempts(orgId, userId).catch(() => {})

    const state = await loadPathState(orgId, userId)
    setPath(state)
    setLoading(false)

    // auto-promotion
    const cur = state.current
    if (state.readyForPromotion && cur && state.promotionMode === 'automatic' && state.next && autoTried.current !== cur.rank.id) {
      autoTried.current = cur.rank.id
      setPromoting(true)
      const { error } = await promoteMember(orgId, userId, state.next.id, true)
      setPromoting(false)
      if (!error) setPath(await loadPathState(orgId, userId))
    }

    // network snapshot + upcoming dates (light, off the critical path)
    try {
      const staleBefore = new Date(Date.now() - FOLLOW_UP_STALE_DAYS * 86400000).toISOString()
      const [{ count: direct }, { data: contacts }] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('sponsor_member_id', userId),
        supabase.from('network_marketing_contacts').select('full_name, stage, updated_at').eq('org_id', orgId).eq('user_id', userId).order('updated_at', { ascending: true }),
      ])
      const open = (contacts ?? []).filter((c) => !WON_OR_LOST.has(c.stage as string))
      const due = open.filter((c) => (c.updated_at as string) < staleBefore)
      setNet({ direct: direct ?? 0, followUpsDue: due.length, followUpName: (due[0]?.full_name as string) ?? null })
    } catch { /* leave zeros */ }

    loadMemberBalances(orgId, userId)
      .then((b) => setWallet({ available: b.available, pending: b.pending_platform }))
      .catch(() => {})

    try {
      const items = state.current ? [...state.current.learning, ...state.current.tasks].map((s) => s.item) : []
      const asgIds = items.map((i) => i.coursework_assignment_id).filter(Boolean) as string[]
      const evIds = items.map((i) => i.event_id).filter(Boolean) as string[]
      const rows: Upcoming[] = []
      if (asgIds.length) {
        const { data } = await supabase.from('coursework_assignments').select('id, title, due_date').in('id', asgIds).not('due_date', 'is', null)
        for (const a of (data as { id: string; title: string; due_date: string }[]) ?? []) {
          rows.push({ key: `a-${a.id}`, title: a.title, when: relWhen(a.due_date), href: `/my-assignments/${a.id}` })
        }
      }
      if (evIds.length) {
        const { data } = await supabase.from('events').select('id, title, start_at').in('id', evIds).gte('start_at', new Date().toISOString())
        for (const e of (data as { id: string; title: string; start_at: string }[]) ?? []) {
          rows.push({ key: `e-${e.id}`, title: e.title, when: relWhen(e.start_at), href: `/events/${e.id}` })
        }
      }
      rows.sort((x, y) => x.when.localeCompare(y.when))
      setUpcoming(rows)
    } catch { /* none */ }
  }, [orgId, userId])

  useEffect(() => {
    setLoading(true)
    reload()
  }, [reload])

  if (loading || !path) return <DashboardSkeleton />

  if (path.ranks.length === 0 || !path.current) {
    return (
      <div className="page cmd-deck mdash mrk">
        <section className="md-hero">
          <h1>{timeOfDayGreeting(now)}, {firstName} 👋</h1>
          <p className="md-hero-sub">Your office hasn't set up its Business Path yet — check back soon.</p>
        </section>
      </div>
    )
  }

  const cur = path.current
  const reqs = [...cur.learning, ...cur.tasks].sort((a, b) => a.item.order_index - b.item.order_index)
  const filtered = reqFilter === 'all' ? reqs : reqs.filter((s) => s.item.section === reqFilter)
  const focus = reqs.find((s) => s.item.is_required && !s.complete && s.status !== 'awaiting_approval') ?? reqs.find((s) => !s.complete)
  const learnDone = cur.learning.filter((s) => s.complete).length
  const taskDone = cur.tasks.filter((s) => s.complete).length

  // needs-attention (deduped against visible requirements)
  const attention: { label: string; to: string | (() => void) }[] = []
  const profileReq = reqs.find((s) => s.item.kind === 'profile_completion')
  if (!profileReq && net.direct === 0 && !profile?.avatar_url) attention.push({ label: 'Add a profile photo', to: '/settings' })
  if (net.followUpsDue > 0) attention.push({ label: `Follow up with ${net.followUpName ?? 'a prospect'}`, to: '/my-team' })
  for (const s of reqs) {
    if (s.status === 'changes_requested') attention.push({ label: `"${s.item.title}" needs changes`, to: s.href ?? '/business-path' })
    if (s.status === 'rejected') attention.push({ label: `"${s.item.title}" was rejected`, to: s.href ?? '/business-path' })
  }
  const attn = attention.slice(0, 4)

  return (
    <div className="page cmd-deck mdash mrk">
      {/* ---- header ---- */}
      <section className="md-hero mrk-hero">
        <div className="mrk-hero-main">
          <h1>{timeOfDayGreeting(now)}, {firstName} 👋</h1>
          <p className="md-hero-sub">Your journey. Your goals. Your future.</p>
        </div>
        <div className="mrk-hero-stats">
          <div><span className="mrk-cap">Current rank</span><strong>{cur.rank.name}</strong></div>
          <div><span className="mrk-cap">Overall progress</span><strong>{cur.percent}%</strong></div>
          <div><span className="mrk-cap">Next rank</span><strong>{path.next ? path.next.name : 'Top rank'}</strong></div>
          <Link to="/business-path" className="md-btn ghost">View Business Path</Link>
        </div>
      </section>

      {/* ---- rank ladder ---- */}
      <div className="mrk-ladder">
        {path.ranks.map((r, i) => (
          <div key={r.rank.id} className={`mrk-step ${r.status}`} style={{ ['--i' as string]: i }}>
            {i > 0 && <span className="mrk-step-line" aria-hidden />}
            <span className="mrk-step-orb" aria-hidden>
              {r.status === 'done' ? StepIcon.done : r.status === 'current' ? StepIcon.current : StepIcon.locked}
            </span>
            <span className="mrk-step-name">{r.rank.name}</span>
            <span className="mrk-step-tag">
              {r.status === 'done' ? '✓ Completed' : r.status === 'current' ? 'In Progress' : 'Locked'}
            </span>
          </div>
        ))}
      </div>

      {/* ---- promotion / approval banner ---- */}
      {path.readyForPromotion && (
        <div className={`mrk-banner ${promoting ? 'info' : 'ok'}`}>
          {promoting
            ? <span>Promoting you to {path.next?.name}…</span>
            : !path.next
              ? <span>🎉 You've reached the top rank — every requirement is complete.</span>
              : <span>All requirements complete. {path.promotionMode === 'approval' ? `Awaiting staff approval for ${path.next.name}.` : `Advancing to ${path.next.name}…`}</span>}
        </div>
      )}
      {path.awaitingApproval && !path.readyForPromotion && (
        <div className="mrk-banner wait"><span>One or more requirements are awaiting staff approval.</span></div>
      )}

      <TodayActionCenter orgId={orgId!} userId={userId!} path={path} />

      <div className="dash-grid">
        {/* ---- current rank summary + requirements ---- */}
        <section className="dash-card col-8">
          <div className="mrk-summary">
            <Ring percent={cur.percent} />
            <div className="mrk-summary-body">
              <span className="mrk-cap">Current rank</span>
              <h2>{cur.rank.name}</h2>
              <p className="md-muted">
                {cur.requiredDone} of {cur.requiredTotal} requirements · Learning {learnDone}/{cur.learning.length} · Tasks {taskDone}/{cur.tasks.length}
              </p>
              <Link to="/business-path" className="md-btn">Continue Business Path</Link>
            </div>
          </div>

          {focus && (
            <div className="mrk-focus">
              <span className="mrk-cap">Current focus</span>
              <div className="mrk-focus-title">{focus.item.title}</div>
              {focus.item.instructions && <p className="md-muted">{focus.item.instructions}</p>}
              <p className="mrk-focus-status">{statusLabel(focus)}</p>
              {focus.href && (focus.href.startsWith('http')
                ? <a className="md-btn" href={focus.href} target="_blank" rel="noreferrer">Open →</a>
                : <Link className="md-btn" to={focus.href}>Open →</Link>)}
              {focus.item.kind === 'daily_reports' && <button type="button" className="md-btn" onClick={() => setReportOpen(true)}>Log today's report</button>}
            </div>
          )}

          <div className="dash-card-head" style={{ marginTop: 18 }}>
            <h2>Current rank requirements</h2>
            <div className="view-tabs" style={{ margin: 0, border: 'none' }}>
              {(['all', 'learning', 'task'] as const).map((f) => (
                <button key={f} type="button" className={`view-tab ${reqFilter === f ? 'active' : ''}`} onClick={() => setReqFilter(f)}>
                  {f === 'all' ? 'All' : f === 'learning' ? 'Learning' : 'Tasks'}
                </button>
              ))}
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="md-muted" style={{ padding: '12px 0' }}>Nothing configured for this rank yet.</p>
          ) : (
            <>
              <div className="mrk-req-list">
                {filtered.slice(0, 4).map((s) => (
                  <RequirementRow key={s.item.id} s={s} orgId={orgId!} userId={userId!} onChange={reload} />
                ))}
              </div>
              {filtered.length > 4 && (
                <button type="button" className="mrk-req-more" onClick={() => navigate('/business-path')}>
                  +{filtered.length - 4} more requirement{filtered.length - 4 === 1 ? '' : 's'} →
                </button>
              )}
            </>
          )}
        </section>

        {/* ---- right rail: quick actions on top, then attention / goals / network ---- */}
        <div className="col-4 md-col">
          <section className="dash-card">
            <div className="dash-card-head"><h2>Quick actions</h2></div>
            <div className="mrk-actions">
              <Link to="/business-path" className="mrk-action">Continue Business Path</Link>
              <Link to="/training" className="mrk-action">Open Learning Center</Link>
            </div>
          </section>

          <section className="dash-card">
            <div className="dash-card-head"><h2>Needs attention</h2></div>
            {attn.length === 0 ? (
              <p className="md-muted">Nothing needs you right now. Nice.</p>
            ) : (
              <div className="mrk-attn-list">
                {attn.map((a, i) => (
                  <button
                    key={i}
                    type="button"
                    className="mrk-attn"
                    onClick={() => (typeof a.to === 'string' ? navigate(a.to) : a.to())}
                  >
                    <span>{a.label}</span>
                    <span className="mrk-attn-cta">Fix →</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="dash-card">
            <div className="dash-card-head"><h2>Goals</h2><Link to="/goals" className="dash-see-all">View →</Link></div>
            {(() => {
              const g3 = reqs.find((s) => s.item.kind === 'three_month_goals')
              const g1 = reqs.find((s) => s.item.kind === 'goal_created' || s.item.kind === 'monthly_goal')
              if (g3) return <><p className="md-muted">90-day plan</p><p className="mrk-big">{g3.current} / 3 months planned</p><Link to="/goals" className="md-btn ghost">Plan goals</Link></>
              if (g1 && !g1.complete) return <><p className="md-muted">Set your first goals to get started.</p><Link to="/goals" className="md-btn">Set goals</Link></>
              return <><p className="md-muted">This month</p><p className="mrk-big">{g1?.complete ? 'Goals set' : 'No goals yet'}</p><Link to="/goals" className="md-btn ghost">Open goals</Link></>
            })()}
          </section>

          <section className="dash-card">
            <div className="dash-card-head"><h2>My network</h2><Link to="/my-team" className="dash-see-all">View →</Link></div>
            <div className="mrk-net">
              <div><span>Direct members</span><strong>{net.direct}</strong></div>
              <div><span>Follow-ups due</span><strong>{net.followUpsDue}</strong></div>
            </div>
          </section>

          {wallet && (wallet.available.length > 0 || wallet.pending.length > 0) && (
            <section className="dash-card">
              <div className="dash-card-head"><h2>Wallet</h2><Link to="/wallet" className="dash-see-all">View →</Link></div>
              <div className="mrk-net">
                <div><span>Available</span><strong>{moneyList(wallet.available)}</strong></div>
                <div><span>Pending platform</span><strong>{moneyList(wallet.pending)}</strong></div>
              </div>
            </section>
          )}
        </div>

        {/* ---- learning progress ---- */}
        <section className="dash-card col-12">
          <div className="dash-card-head">
            <h2>Your learning</h2>
            <Link to="/training" className="dash-see-all">Open Learning Center →</Link>
          </div>
          {path.learningByArea.length === 0 ? (
            <p className="md-muted">Nothing published for your rank yet.</p>
          ) : (
            <div className="mrk-learn-grid">
              {path.learningByArea.map((a) => {
                const pct = a.total > 0 ? Math.round((a.done / a.total) * 100) : 0
                return (
                  <Link to={`/training?area=${a.area}`} className="mrk-learn" key={a.area}>
                    <span className="mrk-learn-name">{a.label}</span>
                    <span className="mrk-learn-count">{a.done} / {a.total}</span>
                    <span className="mrk-learn-bar"><i style={{ width: `${pct}%` }} /></span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {/* ---- upcoming ---- */}
        {upcoming.length > 0 && (
          <section className="dash-card col-4">
            <div className="dash-card-head"><h2>Upcoming</h2></div>
            <div className="mrk-up-list">
              {upcoming.slice(0, 5).map((u) => (
                <Link to={u.href} className="mrk-up" key={u.key}>
                  <span className="mrk-up-title">{u.title}</span>
                  <span className="mrk-up-when">{u.when}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ---- recent activity ---- */}
        <div className={upcoming.length > 0 ? 'col-8' : 'col-12'}>
          <RecentActivity compact limit={6} />
          <OfficeActivityFeed orgId={orgId!} scope="mine" title="Your recent activity" limit={6} />
        </div>
      </div>

      {reportOpen && (
        <ReportModal orgId={orgId!} userId={userId!} onClose={() => setReportOpen(false)} onSaved={() => { setReportOpen(false); reload() }} />
      )}
    </div>
  )
}

function relWhen(iso: string): string {
  const d = new Date(iso)
  const days = Math.round((d.getTime() - Date.now()) / 86400000)
  if (days < 0) return 'Overdue'
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days < 7) return `In ${days} days`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
